import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { SiteCapture } from '@legal-lint/core';
import { createApp, type AppDeps, type LogEntry } from './app.ts';
import { readConfig } from './config.ts';
import { publicWebOnly, type Resolver } from './egress/target.ts';
import { issueKey } from './keys.ts';
import { MemoryStore } from './store.ts';

const NOW = new Date('2026-10-07T12:00:00Z');
const resolve: Resolver = async (h) => ({ 'example.com': ['93.184.215.14'], 'metadata.google.internal': ['169.254.169.254'] })[h] ?? Promise.reject(new Error('ENOTFOUND'));
const capture = (url: string): SiteCapture => ({
  startUrl: url,
  userAgent: 'ua',
  pages: [{ url, finalUrl: url, status: 200, requests: [], cookies: [], text: 'hi', html: '<p>hi</p>', links: [] }],
});

async function setup(overrides: Partial<AppDeps> = {}, env: NodeJS.ProcessEnv = {}) {
  const store = new MemoryStore();
  const good = issueKey('good@example.com', null, NOW);
  const revoked = issueKey('revoked@example.com', null, NOW);
  const expired = issueKey('expired@example.com', '2026-10-01T00:00:00.000Z', NOW);
  for (const k of [good, revoked, expired]) await store.put(k.hash, k.record);
  await store.revoke(revoked.record.prefix, NOW);
  const logs: LogEntry[] = [];
  const scanned: string[] = [];
  const app = createApp({
    keys: store,
    usage: store,
    scanner: { scan: async (url) => (scanned.push(url), capture(url)) },
    policy: publicWebOnly,
    resolve,
    config: readConfig(env),
    now: () => NOW,
    log: (e) => logs.push(e),
    ...overrides,
  });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const scan = (key: string, url = 'https://example.com/pricing?q=secret-path', headers: Record<string, string> = {}) =>
    post('/v1/scan', { url, version: '0.1.0' }, { authorization: `Bearer ${key}`, ...headers });
  return { app, store, good, revoked, expired, logs, scanned, post, scan };
}

describe('POST /v1/licence', () => {
  it('answers valid with the expiry, and invalid with a reason', async () => {
    const { post, good, revoked, expired } = await setup();
    expect(await (await post('/v1/licence', { key: good.key, version: '0.1.0' })).json()).toEqual({ valid: true, expiresAt: null });
    expect(await (await post('/v1/licence', { key: revoked.key, version: '0.1.0' })).json()).toEqual({ valid: false, reason: 'revoked' });
    expect(await (await post('/v1/licence', { key: expired.key, version: '0.1.0' })).json()).toEqual({ valid: false, reason: 'expired' });
    expect(await (await post('/v1/licence', { key: 'll_nope', version: '0.1.0' })).json()).toEqual({ valid: false, reason: 'unknown' });
  });

  it('refuses a malformed or oversized body, or extra fields', async () => {
    const { post, good } = await setup();
    expect((await post('/v1/licence', '{not json')).status).toBe(400);
    expect((await post('/v1/licence', { key: good.key, version: '0.1.0', path: '/Users/me/repo' })).status).toBe(400);
    const big = await post('/v1/licence', { key: good.key, version: 'x'.repeat(5000) });
    expect(big.status).toBe(413);
  });

  it('limits licence checks per IP, and failed keys per IP', async () => {
    const { post, good } = await setup({}, { LICENCE_CHECKS_PER_IP_HOUR: '3', FAILED_AUTH_PER_IP_HOUR: '2' });
    for (let i = 0; i < 3; i++) expect((await post('/v1/licence', { key: good.key, version: '1' })).status).toBe(200);
    const limited = await post('/v1/licence', { key: good.key, version: '1' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect((await post('/v1/licence', { key: good.key, version: '1' }, { 'x-forwarded-for': '198.51.100.1' })).status).toBe(200);

    const other = { 'x-forwarded-for': '198.51.100.2' };
    await post('/v1/licence', { key: 'll_bad1', version: '1' }, other);
    await post('/v1/licence', { key: 'll_bad2', version: '1' }, other);
    expect((await post('/v1/licence', { key: good.key, version: '1' }, other)).status).toBe(429);
  });
});

describe('POST /v1/scan', () => {
  it('returns the capture for a valid key and public URL', async () => {
    const { scan, good, scanned } = await setup();
    const res = await scan(good.key);
    expect(res.status).toBe(200);
    expect((await res.json()).capture.pages[0].text).toBe('hi');
    expect(scanned).toEqual(['https://example.com/pricing?q=secret-path']);
  });

  it('gzips the capture for clients that accept it, to keep outbound traffic small', async () => {
    const { scan, good } = await setup();
    const res = await scan(good.key, undefined, { 'accept-encoding': 'gzip' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    const body = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'));
    expect(body.capture.pages[0].text).toBe('hi');
  });

  it('caps the html and text of each page', async () => {
    const huge = (url: string): SiteCapture => ({
      ...capture(url),
      pages: [{ ...capture(url).pages[0]!, html: 'h'.repeat(3_000_000), text: 't'.repeat(1_000_000) }],
    });
    const { scan, good } = await setup({ scanner: { scan: async (url) => huge(url) } }, { MAX_PAGE_HTML_CHARS: '1000', MAX_PAGE_TEXT_CHARS: '500' });
    const page = (await (await scan(good.key)).json()).capture.pages[0];
    expect(page.html).toHaveLength(1000);
    expect(page.text).toHaveLength(500);
  });

  it('refuses a missing, unknown, revoked or expired key with 401 before scanning', async () => {
    const { post, scan, revoked, expired, scanned } = await setup();
    expect((await post('/v1/scan', { url: 'https://example.com/', version: '1' })).status).toBe(401);
    for (const key of ['ll_nope', revoked.key, expired.key]) expect((await scan(key)).status).toBe(401);
    expect(scanned).toEqual([]);
  });

  it('refuses private and odd URLs with a reason, without using the quota', async () => {
    const { scan, good, scanned } = await setup({}, { SCANS_PER_KEY_HOUR: '1' });
    for (const url of ['http://127.0.0.1/', 'http://localhost:3000/', 'http://169.254.169.254/', 'http://metadata.google.internal/', 'http://[::1]/', 'https://example.com:8443/']) {
      const res = await scan(good.key, url);
      expect(res.status, url).toBe(400);
      const body = await res.json();
      expect(body.error.reason, url).toBe('private_address');
      expect(body.error.message).toMatch(/--local/);
    }
    expect((await (await scan(good.key, 'ftp://example.com/')).json()).error.reason).toBe('bad_url');
    expect(scanned).toEqual([]);
    expect((await scan(good.key)).status).toBe(200);
  });

  it('applies the per-key hourly limit with Retry-After', async () => {
    const { scan, good } = await setup({}, { SCANS_PER_KEY_HOUR: '2' });
    expect((await scan(good.key)).status).toBe(200);
    expect((await scan(good.key)).status).toBe(200);
    const res = await scan(good.key);
    expect(res.status).toBe(429);
    expect((await res.json()).error.reason).toBe('key_hour');
    expect(res.headers.get('retry-after')).toBe('3600');
  });

  it('stops every key at the monthly cap with 503 and points to --local', async () => {
    const { scan, good, store } = await setup({}, { SCANS_PER_MONTH: '2' });
    const second = issueKey('second@example.com', null, NOW);
    await store.put(second.hash, second.record);
    expect((await scan(good.key)).status).toBe(200);
    expect((await scan(second.key)).status).toBe(200);
    const res = await scan(second.key);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.reason).toBe('monthly_budget');
    expect(body.error.message).toMatch(/--local/);
  });

  it('remembers a key that hit its limit until the window ends, so repeats cost no store reads', async () => {
    let t = NOW;
    const { scan, good, store } = await setup({ now: () => t }, { SCANS_PER_KEY_HOUR: '1' });
    expect((await scan(good.key)).status).toBe(200);
    expect((await scan(good.key)).status).toBe(429);
    const get = vi.spyOn(store, 'get');
    const reserve = vi.spyOn(store, 'reserveScan');
    const again = await scan(good.key);
    expect(again.status).toBe(429);
    expect((await again.json()).error.reason).toBe('key_hour');
    expect(again.headers.get('retry-after')).toBe('3600');
    expect(get).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    t = new Date(NOW.getTime() + 3_600_000);
    expect((await scan(good.key)).status).toBe(200);
  });

  it('remembers the monthly cap, so later scans skip the usage store', async () => {
    const { scan, good, store } = await setup({}, { SCANS_PER_MONTH: '1' });
    expect((await scan(good.key)).status).toBe(200);
    expect((await scan(good.key)).status).toBe(503);
    const reserve = vi.spyOn(store, 'reserveScan');
    const again = await scan(good.key);
    expect(again.status).toBe(503);
    expect((await again.json()).error.reason).toBe('monthly_budget');
    expect(reserve).not.toHaveBeenCalled();
  });

  it('answers 503 busy when every slot and queue place is taken', async () => {
    let release!: () => void;
    const { scan, good } = await setup(
      { scanner: { scan: (url) => new Promise((r) => (release = () => r(capture(url)))) } },
      { MAX_RUNNING_SCANS: '1', MAX_WAITING_SCANS: '0' },
    );
    const first = scan(good.key);
    await new Promise((r) => setTimeout(r, 10));
    const second = await scan(good.key);
    expect(second.status).toBe(503);
    expect((await second.json()).error.reason).toBe('busy');
    release();
    expect((await first).status).toBe(200);
  });

  it('reports a failed scan as 502 and still counts it, since the compute was spent', async () => {
    const { scan, good } = await setup({ scanner: { scan: async () => Promise.reject(new Error('browser crashed\nstack')) } }, { SCANS_PER_KEY_HOUR: '1' });
    const res = await scan(good.key);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toEqual({ reason: 'scan_failed', message: 'Could not scan example.com: browser crashed' });
    expect((await scan(good.key)).status).toBe(429);
  });

  it('logs the prefix, host and outcome, never the key or the URL path', async () => {
    const { scan, post, good, logs } = await setup();
    await scan(good.key);
    await post('/v1/licence', { key: good.key, version: '1' });
    expect(logs.map((l) => l.outcome)).toEqual(['ok', 'valid']);
    expect(logs[0]).toMatchObject({ route: 'scan', keyPrefix: good.record.prefix, host: 'example.com' });
    const all = JSON.stringify(logs);
    expect(all).not.toContain(good.key);
    expect(all).not.toContain('secret-path');
    expect(all).not.toContain('203.0.113.7');
  });

  it('answers the health check', async () => {
    const { app } = await setup();
    expect((await app.request('/healthz')).status).toBe(200);
  });
});
