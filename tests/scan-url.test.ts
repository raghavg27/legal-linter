import { describe, expect, it } from 'vitest';
import type { SiteCapture } from '@legal-lint/core';
import { scansLocally, scanUrl } from '../packages/cli/src/scan-url.ts';
import type { Licence } from '../packages/cli/src/licence/gate.ts';
import { fakeFetch, json, TEST_KEY } from './helpers/licence.ts';

const licence: Licence = { key: TEST_KEY, source: 'file', checkedAt: new Date().toISOString(), expiresAt: null };
const fontsCapture = (url: string): SiteCapture => ({
  startUrl: url,
  userAgent: 'ua',
  pages: [{ url, finalUrl: url, status: 200, requests: [{ url: 'https://fonts.googleapis.com/css2?family=Inter', method: 'GET', resourceType: 'stylesheet', msSinceNavigation: 5 }], cookies: [], text: '', html: '', links: [] }],
});
const rtWith = (fetch: typeof globalThis.fetch) => ({ env: { LEGAL_LINT_API_URL: 'https://api.test' }, fetch, now: () => new Date() });

describe('scansLocally', () => {
  it('keeps localhost and private addresses on this machine, and honours --local', () => {
    expect(scansLocally('http://localhost:3000/')).toBe(true);
    expect(scansLocally('http://192.168.0.5/')).toBe(true);
    expect(scansLocally('https://example.com/')).toBe(false);
    expect(scansLocally('https://example.com/', true)).toBe(true);
  });
});

describe('scanUrl remote', () => {
  it('sends only the URL and version (key as bearer), then runs the rules locally with local intake', async () => {
    const fetch = fakeFetch((url, body) => json(200, { capture: fontsCapture((body as { url: string }).url) }));
    const report = await scanUrl('https://example.com/', { rt: rtWith(fetch), licence, version: '0.1.0', only: ['LL-01'], intake: { euUkVisitors: true } });
    expect(fetch.calls).toEqual([{ url: 'https://api.test/v1/scan', body: { url: 'https://example.com/', version: '0.1.0' } }]);
    expect(report.findings.map((f) => [f.ruleId, f.status])).toEqual([['LL-01', 'open']]);
  });

  it('turns API errors into their message', async () => {
    const fetch = fakeFetch(() => json(503, { error: { reason: 'monthly_budget', message: 'The hosted scanner has used its scans for this month. Scan on your own machine with --local.' } }));
    await expect(scanUrl('https://example.com/', { rt: rtWith(fetch), licence, version: '0.1.0' })).rejects.toThrow(/--local/);
  });

  it('rejects a capture it cannot read with directions, not a schema dump', async () => {
    const fetch = fakeFetch(() => json(200, { capture: { startUrl: 'x', pages: 'nope' } }));
    await expect(scanUrl('https://example.com/', { rt: rtWith(fetch), licence, version: '0.1.0' })).rejects.toThrow(/Update legal-lint, or scan on this machine with --local/);
  });

  it('says to use --local when no scanner is configured', async () => {
    const fetch = fakeFetch(() => json(500, {}));
    await expect(scanUrl('https://example.com/', { rt: { env: {}, fetch, now: () => new Date() }, licence, version: '0.1.0' })).rejects.toThrow(/--local/);
    expect(fetch.calls).toEqual([]);
  });

  it('reports a start page the server could not load', async () => {
    const failed: SiteCapture = { startUrl: 'https://example.com/', userAgent: 'ua', pages: [{ url: 'https://example.com/', finalUrl: 'https://example.com/', status: null, requests: [], cookies: [], text: '', html: '', links: [], error: 'net::ERR_NAME_NOT_RESOLVED' }] };
    const fetch = fakeFetch(() => json(200, { capture: failed }));
    await expect(scanUrl('https://example.com/', { rt: rtWith(fetch), licence, version: '0.1.0' })).rejects.toThrow(/Could not load https:\/\/example.com\/: net::ERR_NAME_NOT_RESOLVED/);
  });
});
