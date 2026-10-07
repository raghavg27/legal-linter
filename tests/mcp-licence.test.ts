import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../packages/cli/src/mcp/serve.ts';
import type { RuntimeEnv } from '../packages/cli/src/licence/store.ts';
import { FIXTURES_DIR } from './helpers/fixtures.ts';
import { fakeFetch, json, makeHome } from './helpers/licence.ts';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function connect(runtime: RuntimeEnv): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const handle = startServer({ version: '0.0.0-test', runtime }, serverSide);
  const client = new Client({ name: 'licence-test', version: '1.0.0' });
  await client.connect(clientSide);
  closers.push(async () => {
    await client.close();
    await handle.close();
  });
  return client;
}

const ARGS: Record<string, Record<string, unknown>> = {
  preflight_check: { building: 'Stripe subscriptions' },
  scan_repo: {},
  scan_url: { url: 'https://example.com/' },
  get_fix_guidance: { ruleId: 'LL-01' },
  answer_judgment: { findingId: 'LL-02-0123456789', answer: 'marketing', contentHash: 'x', reason: 'because' },
  answer_intake: { answers: { euUkVisitors: true } },
  explain_rule: { ruleId: 'LL-01' },
};

describe('MCP server without a key', () => {
  it('lists all seven tools, and every call returns the licence error', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-mcp-keyless-'));
    await cp(path.join(FIXTURES_DIR, 'LL-01', 'fires-vite-css-import'), dir, { recursive: true });
    const client = await connect({ env: { LEGAL_LINT_HOME: await makeHome({ key: null, checkedAt: null }), LEGAL_LINT_API_URL: 'https://api.test' }, fetch: fakeFetch(() => json(500, {})), now: () => new Date() });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(ARGS).sort());
    for (const [name, args] of Object.entries(ARGS)) {
      const result = (await client.callTool({ name, arguments: { ...args, path: dir } })) as CallToolResult;
      expect(result.isError, name).toBe(true);
      expect(result.content.map((c) => (c.type === 'text' ? c.text : '')).join(''), name).toMatch(/needs a licence key.*LEGAL_LINT_KEY/);
    }
  });
});

describe('MCP server with a key', () => {
  it('runs tools normally (the main MCP suite covers each tool keyed)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-mcp-keyed-'));
    await cp(path.join(FIXTURES_DIR, 'LL-01', 'fires-vite-css-import'), dir, { recursive: true });
    const client = await connect({ env: { LEGAL_LINT_HOME: await makeHome(), LEGAL_LINT_API_URL: 'https://api.test' }, fetch: fakeFetch(() => json(500, {})), now: () => new Date() });
    const result = (await client.callTool({ name: 'explain_rule', arguments: { ruleId: 'LL-01', path: dir } })) as CallToolResult;
    expect(result.isError).toBeFalsy();
  });

  it('scan_url sends a public URL to the hosted scanner and runs the rules locally', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-mcp-remote-'));
    await cp(path.join(FIXTURES_DIR, 'LL-01', 'fires-runtime-link-tag'), dir, { recursive: true });
    const url = 'https://example.com/';
    const capture = { startUrl: url, userAgent: 'ua', pages: [{ url, finalUrl: url, status: 200, requests: [{ url: 'https://fonts.googleapis.com/css2?family=Inter', method: 'GET', resourceType: 'stylesheet', msSinceNavigation: 3 }], cookies: [], text: '', html: '', links: [] }] };
    const fetch = fakeFetch(() => json(200, { capture }));
    const client = await connect({ env: { LEGAL_LINT_HOME: await makeHome(), LEGAL_LINT_API_URL: 'https://api.test' }, fetch, now: () => new Date() });
    const result = (await client.callTool({ name: 'scan_url', arguments: { url, path: dir, rules: ['LL-01'] } })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { summary: { open: number } }).summary.open).toBe(1);
    expect(fetch.calls.map((c) => c.body)).toEqual([{ url, version: '0.0.0-test' }]);
  });
});
