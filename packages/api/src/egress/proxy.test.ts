import { once } from 'node:events';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startEgressProxy, type EgressProxy } from './proxy.ts';
import type { Resolver } from './target.ts';

// Real sockets only: an "allowed" server on 127.0.0.1 and an "internal" one on ::1.
// The test policy allows 127.0.0.1 and nothing else.
const allowLocalV4 = (ip: string) => ip === '127.0.0.1';

async function listen(host: string, handler: http.RequestListener = (_req, res) => res.end('ok')) {
  const server = http.createServer(handler);
  let connections = 0;
  server.on('connection', () => connections++);
  server.listen(0, host);
  await once(server, 'listening');
  return { server, port: (server.address() as AddressInfo).port, connections: () => connections };
}

/** Sends one raw request to the proxy and returns the status line. */
async function rawStatus(proxyUrl: string, request: string): Promise<string> {
  const { port } = new URL(proxyUrl);
  const socket = net.connect(Number(port), '127.0.0.1');
  await once(socket, 'connect');
  socket.write(request);
  const [chunk] = (await once(socket, 'data')) as [Buffer];
  socket.destroy();
  return chunk.toString().split('\r\n')[0]!;
}

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function proxyWith(resolve: Resolver = async () => { throw new Error('ENOTFOUND'); }): Promise<EgressProxy> {
  const proxy = await startEgressProxy({ policy: allowLocalV4, resolve });
  cleanup.push(() => proxy.close());
  return proxy;
}

describe('egress proxy', () => {
  it('forwards a plain http request to an allowed address', async () => {
    const ok = await listen('127.0.0.1');
    cleanup.push(() => void ok.server.close());
    const proxy = await proxyWith();
    expect(await rawStatus(proxy.url, `GET http://127.0.0.1:${ok.port}/ HTTP/1.1\r\nHost: 127.0.0.1:${ok.port}\r\nConnection: close\r\n\r\n`)).toBe('HTTP/1.1 200 OK');
  });

  it('refuses plain http, CONNECT and websocket upgrades to a refused address without connecting', async () => {
    const internal = await listen('::1');
    cleanup.push(() => void internal.server.close());
    const proxy = await proxyWith();
    const target = `[::1]:${internal.port}`;
    expect(await rawStatus(proxy.url, `GET http://${target}/secret HTTP/1.1\r\nHost: ${target}\r\n\r\n`)).toMatch(/^HTTP\/1\.1 403/);
    expect(await rawStatus(proxy.url, `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)).toMatch(/^HTTP\/1\.1 403/);
    expect(
      await rawStatus(proxy.url, `GET http://${target}/ws HTTP/1.1\r\nHost: ${target}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`),
    ).toMatch(/^HTTP\/1\.1 403/);
    expect(internal.connections()).toBe(0);
    expect(proxy.refused).toEqual([target, target, target]);
  });

  it('opens a CONNECT tunnel to an allowed address', async () => {
    const ok = await listen('127.0.0.1');
    cleanup.push(() => void ok.server.close());
    const proxy = await proxyWith();
    expect(await rawStatus(proxy.url, `CONNECT 127.0.0.1:${ok.port} HTTP/1.1\r\nHost: 127.0.0.1:${ok.port}\r\n\r\n`)).toBe('HTTP/1.1 200 Connection Established');
  });

  it('resolves names itself and refuses when any answer is refused', async () => {
    const internal = await listen('::1');
    cleanup.push(() => void internal.server.close());
    const proxy = await proxyWith(async (h) => (h === 'mixed.test' ? ['127.0.0.1', '::1'] : []));
    expect(await rawStatus(proxy.url, `GET http://mixed.test:${internal.port}/ HTTP/1.1\r\nHost: mixed.test\r\n\r\n`)).toMatch(/^HTTP\/1\.1 403/);
    expect(await rawStatus(proxy.url, `GET http://nowhere.test/ HTTP/1.1\r\nHost: nowhere.test\r\n\r\n`)).toMatch(/^HTTP\/1\.1 403/);
    expect(internal.connections()).toBe(0);
  });
});
