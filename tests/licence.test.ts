import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { activate, checkLicence, GRACE_MS, LicenceError } from '../packages/cli/src/licence/gate.ts';
import type { RuntimeEnv } from '../packages/cli/src/licence/store.ts';
import { fakeFetch, json, makeHome, TEST_KEY } from './helpers/licence.ts';

const NOW = new Date('2026-10-07T12:00:00Z');
const HOUR = 3_600_000;
const API = 'https://api.test';
const valid = fakeFetch(() => json(200, { valid: true, expiresAt: null }));

function rt(home: string, fetch: typeof globalThis.fetch, env: NodeJS.ProcessEnv = {}): RuntimeEnv {
  return { env: { LEGAL_LINT_HOME: home, LEGAL_LINT_API_URL: API, ...env }, fetch, now: () => NOW };
}

describe('checkLicence', () => {
  it('refuses with directions when there is no key', async () => {
    const home = await makeHome({ key: null, checkedAt: null });
    await expect(checkLicence(rt(home, valid), '0.1.0')).rejects.toThrow(/LEGAL_LINT_KEY.*legal-lint activate/);
  });

  it('uses a fresh cache without calling the API', async () => {
    const fetch = fakeFetch(() => json(500, {}));
    const home = await makeHome({ checkedAt: new Date(NOW.getTime() - 23 * HOUR) });
    const licence = await checkLicence(rt(home, fetch), '0.1.0');
    expect(licence).toMatchObject({ key: TEST_KEY, source: 'file' });
    expect(licence.warning).toBeUndefined();
    expect(fetch.calls).toEqual([]);
  });

  it('checks again after 24 hours, sends only key and version, and refreshes the cache', async () => {
    const fetch = fakeFetch(() => json(200, { valid: true, expiresAt: '2027-01-01T00:00:00.000Z' }));
    const home = await makeHome({ checkedAt: new Date(NOW.getTime() - 25 * HOUR) });
    const licence = await checkLicence(rt(home, fetch), '0.1.0');
    expect(fetch.calls).toEqual([{ url: `${API}/v1/licence`, body: { key: TEST_KEY, version: '0.1.0' } }]);
    expect(licence.expiresAt).toBe('2027-01-01T00:00:00.000Z');
    const cache = JSON.parse(await readFile(path.join(home, 'licence.json'), 'utf8'));
    expect(cache.checkedAt).toBe(NOW.toISOString());
    expect(JSON.stringify(cache)).not.toContain(TEST_KEY);
  });

  it('prefers LEGAL_LINT_KEY over the key file', async () => {
    const fetch = fakeFetch(() => json(200, { valid: true, expiresAt: null }));
    const home = await makeHome({ checkedAt: null });
    const other = 'll_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';
    const licence = await checkLicence(rt(home, fetch, { LEGAL_LINT_KEY: other }), '0.1.0');
    expect(licence).toMatchObject({ key: other, source: 'env' });
    expect(fetch.calls[0]!.body).toEqual({ key: other, version: '0.1.0' });
  });

  it('works for 7 days with a warning when the API is unreachable, then stops', async () => {
    const down = fakeFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    const sixDays = await makeHome({ checkedAt: new Date(NOW.getTime() - 6 * 24 * HOUR) });
    const licence = await checkLicence(rt(sixDays, down), '0.1.0');
    expect(licence.warning).toMatch(/Could not reach the licence server/);
    const eightDays = await makeHome({ checkedAt: new Date(NOW.getTime() - GRACE_MS - HOUR) });
    await expect(checkLicence(rt(eightDays, down), '0.1.0')).rejects.toThrow(/Could not check the licence key/);
  });

  it('treats 5xx and 429 as unreachable, so grace applies', async () => {
    for (const status of [500, 503, 429]) {
      const home = await makeHome({ checkedAt: new Date(NOW.getTime() - 2 * 24 * HOUR) });
      const licence = await checkLicence(rt(home, fakeFetch(() => json(status, {}))), '0.1.0');
      expect(licence.warning, String(status)).toBeTruthy();
    }
  });

  it('stops at once on a definite invalid answer, with no grace, and deletes the cache', async () => {
    for (const reason of ['unknown', 'revoked', 'expired'] as const) {
      const home = await makeHome({ checkedAt: new Date(NOW.getTime() - 2 * 24 * HOUR) });
      const err = await checkLicence(rt(home, fakeFetch(() => json(200, { valid: false, reason }))), '0.1.0').catch((e) => e);
      expect(err).toBeInstanceOf(LicenceError);
      expect(err.message).toContain('ll_01234');
      expect(err.message).not.toContain(TEST_KEY);
      await expect(stat(path.join(home, 'licence.json'))).rejects.toThrow();
    }
  });

  it('refuses a cached licence past its expiry, even inside 24 hours', async () => {
    const fetch = fakeFetch(() => json(200, { valid: false, reason: 'expired' }));
    const home = await makeHome({ checkedAt: new Date(NOW.getTime() - HOUR), expiresAt: new Date(NOW.getTime() - 1000).toISOString() });
    await expect(checkLicence(rt(home, fetch), '0.1.0')).rejects.toThrow(/expired/);
    expect(fetch.calls).toHaveLength(1);
  });

  it('ignores a cache for a different key, a corrupt cache, and spaces or CRLF in the key file', async () => {
    const fetch = fakeFetch(() => json(200, { valid: true, expiresAt: null }));
    const otherKeyCache = await makeHome({ cacheKey: 'll_somebodyElsesKeyXXXXXXXXXXXXXXXXX' });
    await checkLicence(rt(otherKeyCache, fetch), '0.1.0');
    expect(fetch.calls).toHaveLength(1);

    const corrupt = await makeHome();
    await writeFile(path.join(corrupt, 'licence.json'), '{"keyHash": 12');
    await writeFile(path.join(corrupt, 'key'), `  ${TEST_KEY}\r\n`);
    expect((await checkLicence(rt(corrupt, fetch), '0.1.0')).key).toBe(TEST_KEY);
    expect(fetch.calls).toHaveLength(2);
  });

  it('explains a missing API URL instead of failing obscurely', async () => {
    const home = await makeHome({ checkedAt: null });
    await expect(checkLicence({ env: { LEGAL_LINT_HOME: home }, fetch: valid, now: () => NOW }, '0.1.0')).rejects.toThrow(/LEGAL_LINT_API_URL/);
  });
});

describe('activate', () => {
  it('checks the key, then saves it readable only by the user, and caches the answer', async () => {
    const home = await makeHome({ key: null, checkedAt: null });
    const result = await activate(rt(home, valid), `  ${TEST_KEY}\n`, '0.1.0');
    expect(result.file).toBe(path.join(home, 'key'));
    expect((await readFile(result.file, 'utf8')).trim()).toBe(TEST_KEY);
    expect((await stat(result.file)).mode & 0o777).toBe(0o600);
    expect(await checkLicence(rt(home, fakeFetch(() => json(500, {}))), '0.1.0')).toMatchObject({ key: TEST_KEY });
  });

  it('saves nothing when the key is invalid or the API is unreachable', async () => {
    for (const fetch of [fakeFetch(() => json(200, { valid: false, reason: 'unknown' })), fakeFetch(() => Promise.reject(new Error('offline')))]) {
      const home = await makeHome({ key: null, checkedAt: null });
      await expect(activate(rt(home, fetch), TEST_KEY, '0.1.0')).rejects.toBeInstanceOf(LicenceError);
      await expect(stat(path.join(home, 'key'))).rejects.toThrow();
    }
  });
});
