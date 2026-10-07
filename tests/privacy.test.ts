import { readdirSync, readFileSync, statSync } from 'node:fs';
import { cp, mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanRepo } from '@legal-lint/core';
import { rules } from '@legal-lint/rules';
import { startServer } from '../packages/cli/src/mcp/serve.ts';
import { run } from '../packages/cli/src/program.ts';
import { FIXTURES_DIR } from './helpers/fixtures.ts';
import { makeHome, TEST_KEY } from './helpers/licence.ts';

// Product promise: the source code of the user never goes out of their machine.
// During a repo scan, the test stops each outbound channel. The sent data must
// not contain a file path or a line of file content from the scanned repo.

interface Outbound {
  channel: string;
  payload: string;
}

function secretsOf(root: string): string[] {
  const secrets = [root];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) {
        visit(abs);
        continue;
      }
      secrets.push(path.relative(root, abs));
      for (const line of readFileSync(abs, 'utf8').split('\n')) {
        // Short lines such as "}" or "return (" would match all data.
        if (line.trim().length >= 12) secrets.push(line.trim());
      }
    }
  };
  visit(root);
  return secrets;
}

export function findLeaks(outbound: Outbound[], secrets: string[]): string[] {
  return outbound.flatMap((o) => secrets.filter((s) => o.payload.includes(s)).map((s) => `${o.channel}: ${s}`));
}

describe('privacy', () => {
  const outbound: Outbound[] = [];
  const record = (channel: string) => (...args: unknown[]) => {
    outbound.push({ channel, payload: JSON.stringify(args, (_k, v) => (typeof v === 'function' ? undefined : v)) });
    throw new Error(`blocked outbound ${channel} during privacy test`);
  };

  beforeEach(() => {
    outbound.length = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(record('fetch') as typeof fetch);
    vi.spyOn(http, 'request').mockImplementation(record('http.request') as typeof http.request);
    vi.spyOn(https, 'request').mockImplementation(record('https.request') as typeof https.request);
    vi.spyOn(net, 'connect').mockImplementation(record('net.connect') as typeof net.connect);
    vi.spyOn(net, 'createConnection').mockImplementation(record('net.createConnection') as typeof net.createConnection);
    vi.spyOn(tls, 'connect').mockImplementation(record('tls.connect') as typeof tls.connect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a repo scan sends nothing that contains file paths or contents', async () => {
    const root = path.join(FIXTURES_DIR, 'LL-01', 'fires-next-pages-document');
    const report = await scanRepo(root, { rules, toolVersion: '0.0.0-test' });
    expect(report.findings.length).toBeGreaterThan(0);
    expect(findLeaks(outbound, secretsOf(root))).toEqual([]);
    // The core scanner never calls the server. The licence check is in the CLI and MCP layers (tested below).
    expect(outbound).toEqual([]);
  });

  it('a repo scan through the MCP server sends nothing either', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'legal-lint-privacy-'));
    await cp(path.join(FIXTURES_DIR, 'LL-02', 'judgment-welcome-unanswered'), root, { recursive: true });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const handle = startServer({ version: '0.0.0-test' }, serverSide);
    const client = new Client({ name: 'privacy-test', version: '1.0.0' });
    try {
      await client.connect(clientSide);
      const result = await client.callTool({ name: 'scan_repo', arguments: { path: root } });
      expect(result.isError).toBeFalsy();
      expect((result.structuredContent as { findings: unknown[] }).findings.length).toBeGreaterThan(0);
    } finally {
      await client.close();
      await handle.close();
    }
    expect(findLeaks(outbound, secretsOf(root))).toEqual([]);
    expect(outbound).toEqual([]);
  });

  async function cliScan(root: string, home: string) {
    const env = { ...process.env, LEGAL_LINT_HOME: home, LEGAL_LINT_API_URL: 'https://api.legal-lint.test' };
    // The code gets fetch for each call. Thus the spy above sees the licence request.
    return run(['scan', root, '--json'], { stdout: { write: () => true }, stderr: { write: () => true } }, { env, fetch: (...a) => globalThis.fetch(...a), now: () => new Date() });
  }

  it('a CLI scan with a fresh licence cache makes no outbound call', async () => {
    const root = path.join(FIXTURES_DIR, 'LL-01', 'fires-next-pages-document');
    expect(await cliScan(root, await makeHome())).toBe(1);
    expect(outbound).toEqual([]);
  });

  it('a CLI scan with a stale cache sends exactly one licence check, carrying only the key and version', async () => {
    const root = path.join(FIXTURES_DIR, 'LL-01', 'fires-next-pages-document');
    // Two days old: the tool tries the check, this test blocks it, and the grace period lets the scan run.
    const home = await makeHome({ checkedAt: new Date(Date.now() - 2 * 86_400_000) });
    expect(await cliScan(root, home)).toBe(1);
    expect(outbound.map((o) => o.channel)).toEqual(['fetch']);
    const [url, init] = JSON.parse(outbound[0]!.payload) as [string, { body: string }];
    expect(url).toBe('https://api.legal-lint.test/v1/licence');
    expect(JSON.parse(init.body)).toEqual({ key: TEST_KEY, version: expect.any(String) });
    expect(findLeaks(outbound, secretsOf(root))).toEqual([]);
  });

  it('the leak check itself catches a leaked line and a leaked path', () => {
    const root = path.join(FIXTURES_DIR, 'LL-01', 'fires-next-pages-document');
    const secrets = secretsOf(root);
    const leaked = [
      { channel: 'fetch', payload: JSON.stringify({ key: 'k', snippet: "import { Html, Head, Main, NextScript } from 'next/document';" }) },
      { channel: 'fetch', payload: JSON.stringify({ key: 'k', file: 'pages/_document.tsx' }) },
    ];
    expect(findLeaks(leaked, secrets)).toHaveLength(2);
    expect(findLeaks([{ channel: 'fetch', payload: '{"key":"k","version":"0.1.0"}' }], secrets)).toEqual([]);
  });
});
