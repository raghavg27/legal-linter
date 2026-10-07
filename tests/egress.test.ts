import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScanner, type Scanner } from '../packages/api/src/scan.ts';
import { publicWebOnly, type Resolver } from '../packages/api/src/egress/target.ts';

// The hosted scanner must never connect to an internal address, for all the methods
// that the page can try: redirect, image, iframe, websocket, or a DNS answer that changes.
// "internal" listens on ::1. The test policy permits only 127.0.0.1.

const VERSION = '0.0.0-test';
let internal: { server: http.Server; port: number; hits: number };
let site: { server: http.Server; port: number };

async function listen(host: string, handler: http.RequestListener) {
  const server = http.createServer(handler);
  server.listen(0, host);
  await once(server, 'listening');
  return { server, port: (server.address() as AddressInfo).port };
}

beforeAll(async () => {
  const i = await listen('::1', (_req, res) => res.end('secret'));
  internal = { ...i, hits: 0 };
  i.server.on('connection', () => internal.hits++);
  i.server.on('upgrade', (_req, socket) => socket.destroy());
  const target = `[::1]:${i.port}`;
  const pages: Record<string, string> = {
    '/image': `<img src="http://${target}/img.png">`,
    '/iframe': `<iframe src="http://${target}/"></iframe>`,
    '/ws': `<script>new WebSocket('ws://${target}/');</script>`,
    '/fetch': `<script>fetch('http://${target}/api').catch(() => {});</script>`,
    // Freezes the main thread of the page after it loads. Thus a read of the page never returns.
    '/hang': `<script>addEventListener('load', () => setTimeout(() => { for (;;) {} }, 0));</script>`,
  };
  site = await listen('127.0.0.1', (req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `http://${target}/secret` }).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>t</title>${pages[req.url ?? ''] ?? '<p>hello</p>'}`);
  });
});

afterAll(async () => {
  internal.server.close();
  site.server.close();
});

const allowLocalV4 = (ip: string) => ip === '127.0.0.1';
const noDns: Resolver = async (h) => {
  throw new Error(`ENOTFOUND ${h}`);
};

describe('hosted scanner egress', () => {
  let scanner: Scanner;
  beforeAll(async () => {
    scanner = await createScanner({ policy: allowLocalV4, resolve: noDns, toolVersion: VERSION, pageTimeoutMs: 5_000, budgetMs: 5_000 });
  });
  afterAll(async () => {
    await scanner.close();
  });

  it('loads an allowed page through the proxy', async () => {
    const capture = await scanner.scan(`http://127.0.0.1:${site.port}/`);
    expect(capture.pages[0]?.status).toBe(200);
    expect(capture.pages[0]?.text).toContain('hello');
  });

  for (const path of ['/redirect', '/image', '/iframe', '/ws', '/fetch']) {
    it(`never reaches the internal server from ${path}`, async () => {
      const before = internal.hits;
      await scanner.scan(`http://127.0.0.1:${site.port}${path}`);
      expect(internal.hits - before).toBe(0);
      expect(scanner.proxy.refused).toContain(`[::1]:${internal.port}`);
    });
  }

  it('refuses a name that resolves to an allowed address first and an internal one second (DNS rebinding)', async () => {
    let calls = 0;
    const rebinding: Resolver = async () => (calls++ === 0 ? ['127.0.0.1'] : ['::1']);
    const s = await createScanner({ policy: allowLocalV4, resolve: rebinding, toolVersion: VERSION, pageTimeoutMs: 5_000 });
    try {
      // The input check sees 127.0.0.1 (call 1). The proxy resolves again (call 2).
      expect(await rebinding('rebind.test')).toEqual(['127.0.0.1']);
      const before = internal.hits;
      const capture = await s.scan(`http://rebind.test:${internal.port}/`);
      expect(capture.pages[0]?.error ?? `status ${capture.pages[0]?.status}`).toMatch(/ERR_|status 403/);
      expect(internal.hits - before).toBe(0);
    } finally {
      await s.close();
    }
  });

  it('sends loopback through the proxy too, so the production policy refuses it', async () => {
    const s = await createScanner({ policy: publicWebOnly, resolve: noDns, toolVersion: VERSION, pageTimeoutMs: 5_000 });
    let hits = 0;
    const counter = () => hits++;
    site.server.on('connection', counter);
    try {
      await s.scan(`http://127.0.0.1:${site.port}/`);
      expect(hits).toBe(0);
      expect(s.proxy.refused).toContain(`127.0.0.1:${site.port}`);
    } finally {
      site.server.off('connection', counter);
      await s.close();
    }
  });

  it('stops a scan at its hard deadline and frees the browser for the next one', async () => {
    const s = await createScanner({ policy: allowLocalV4, resolve: noDns, toolVersion: VERSION, pageTimeoutMs: 5_000, deadlineMs: 3_000 });
    try {
      const started = Date.now();
      await expect(s.scan(`http://127.0.0.1:${site.port}/hang`)).rejects.toThrow(/stopped after 3 s/);
      expect(Date.now() - started).toBeLessThan(10_000);
      const capture = await s.scan(`http://127.0.0.1:${site.port}/`);
      expect(capture.pages[0]?.status).toBe(200);
    } finally {
      await s.close();
    }
  });

  it('launches a new browser when the old one is gone', async () => {
    const s = await createScanner({ policy: allowLocalV4, resolve: noDns, toolVersion: VERSION, pageTimeoutMs: 5_000 });
    try {
      await s.scan(`http://127.0.0.1:${site.port}/`);
      await s.closeBrowserForTest();
      const capture = await s.scan(`http://127.0.0.1:${site.port}/`);
      expect(capture.pages[0]?.status).toBe(200);
    } finally {
      await s.close();
    }
  });
});
