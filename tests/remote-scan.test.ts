import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type ScanReport } from '@legal-lint/core';
import { createApp } from '../packages/api/src/app.ts';
import { readConfig } from '../packages/api/src/config.ts';
import { issueKey } from '../packages/api/src/keys.ts';
import { createScanner, type Scanner } from '../packages/api/src/scan.ts';
import { MemoryStore } from '../packages/api/src/store.ts';
import { checkLicence } from '../packages/cli/src/licence/gate.ts';
import type { RuntimeEnv } from '../packages/cli/src/licence/store.ts';
import { scanUrl } from '../packages/cli/src/scan-url.ts';
import { FIXTURES_DIR } from './helpers/fixtures.ts';
import { makeHome } from './helpers/licence.ts';
import { serveStatic } from './helpers/static-server.ts';

// The real API app and scanner, in process, against a runtime fixture. The
// fixture is reached as "fixture.test", which only the test resolver knows;
// every other host (fonts.googleapis.com included) fails to resolve, so
// nothing leaves the machine. The requests are still recorded by Chromium.

const VERSION = '0.0.0-test';
const FIXTURE = path.join(FIXTURES_DIR, 'LL-01', 'fires-runtime-link-tag');

let site: { url: string; close: () => Promise<void> };
let scanner: Scanner;
let api: ReturnType<typeof serve>;
let rt: RuntimeEnv;
let browser: Browser;

beforeAll(async () => {
  site = await serveStatic(path.join(FIXTURE, 'site'));
  const policy = (ip: string) => ip === '127.0.0.1';
  const resolve = async (h: string) => (h === 'fixture.test' ? ['127.0.0.1'] : Promise.reject(new Error(`ENOTFOUND ${h}`)));
  scanner = await createScanner({ policy, resolve, toolVersion: VERSION, pageTimeoutMs: 10_000 });
  const store = new MemoryStore();
  const { key, hash, record } = issueKey('e2e', null, new Date());
  await store.put(hash, record);
  const app = createApp({ keys: store, usage: store, scanner, policy, resolve, config: readConfig({}), log: () => {} });
  api = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await once(api, 'listening');
  const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  rt = { env: { LEGAL_LINT_HOME: await makeHome({ key, checkedAt: null }), LEGAL_LINT_API_URL: apiUrl }, fetch: globalThis.fetch, now: () => new Date() };
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  api?.close();
  await scanner?.close();
  await site?.close();
});

const shape = (r: ScanReport) =>
  r.findings.map((f) => ({ ruleId: f.ruleId, status: f.status, confidence: f.confidence, requests: f.evidence.map((e) => (e.kind === 'runtime' ? e.requestUrl : e.kind)) }));

describe('remote URL scan, end to end', () => {
  it('validates the key against the real API, then gives the same findings as a local scan', async () => {
    const licence = await checkLicence(rt, VERSION);
    const intake = (await loadConfig(FIXTURE))?.intake ?? null;
    const port = new URL(site.url).port;
    const remote = await scanUrl(`http://fixture.test:${port}/`, { rt, licence, version: VERSION, only: ['LL-01'], intake });
    const local = await scanUrl(site.url, { rt, licence, version: VERSION, only: ['LL-01'], intake, capture: { browser, offline: true } });
    expect(remote.target.kind).toBe('url');
    expect(shape(remote)).toEqual(shape(local));
    expect(shape(remote)).toEqual([{ ruleId: 'LL-01', status: 'open', confidence: 'high', requests: ['https://fonts.googleapis.com/css2?family=Inter&display=swap'] }]);
  });
});
