# Milestone 5: Hosted API and Licence Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to do this plan one task at a time. The steps use checkbox (`- [ ]`) syntax to record progress.

**Goal:** A Cloud Run service that validates licence keys and loads public URLs in Chromium behind an egress proxy that prevents SSRF. Also a licence gate in the CLI and in the MCP server (no free tier).

**Architecture:** A new private package `packages/api` (Hono on Node, a Firestore store for keys and usage, an egress proxy in the process in front of Playwright Chromium). The server returns a raw `SiteCapture`. The CLI runs the rules locally with `evaluateCapture`. Thus intake and judgments never go out of the machine. The CLI gets `src/licence/` (key lookup, 24 h cache, 7-day grace, API client) and `src/scan-url.ts` (local or remote). The commands and the MCP tools both use them.

**Tech Stack:** TypeScript 6, Node 22 (container) / >=20 (CLI), pnpm 10 workspace, Hono 4.13.13, @hono/node-server 2.1.3, ipaddr.js 2.5.0, @google-cloud/firestore 9.3.1, Playwright 1.63.0, zod 4.6.5, Vitest 5, tsup 8.5.1.

**Spec:** `docs/superpowers/specs/2026-10-07-milestone-5-design.md`

## Global Constraints

- The only data that goes to the API: the licence key, the package version and, for URL scans, the URL. Never file paths, file contents, intake or judgments.
- No free tier: without a valid key, `scan`, `scan-url` and each MCP tool refuse to run. `--help`, `--version`, `init`, `activate` and `licence` run without a key.
- The sequence of key sources: `LEGAL_LINT_KEY`, then `~/.legal-lint/key` (`LEGAL_LINT_HOME` overrides the folder). The tool refuses `licenceKey` in `legal-lint.config.json`.
- Cache: 24 hours. Grace: 7 days, only when the tool cannot connect to the API (network error, timeout, 5xx, 429). A clear invalid, revoked or expired answer stops the tool immediately and deletes the cache.
- Key format: `ll_` and 32 base62 characters. The server keeps only `sha256(key)` as the document id, and the first 8 characters.
- Limits (you can set them with environment variables): 1,500 scans for each UTC month for the service; 10 for each key for each UTC hour; 50 for each key for each UTC day; 30 licence checks for each IP address for each hour; 10 failed authentications for each IP address for each hour; 2 scans that run, 4 that wait. The API refuses request bodies larger than 4 KB.
- Scan budget: after 40 s, the scan does not start a new page. Each page has a load timeout of 15 s.
- The hosted scanner loads only public unicast addresses on ports 80 and 443. It checks this at the input, and again on each connection that Chromium makes.
- Cloud Run: us-central1, request-based billing (`--cpu-throttling`), a maximum of 1 instance, a minimum of 0, 1 vCPU, 2 GiB, timeout 120 s. Nothing is deployed in this milestone. The owner deploys with `DEPLOY.md`.
- Logs contain only the route, the outcome, the key prefix, the URL host and the duration. Never the full key, the URL path or file data.
- No LLM calls, no obfuscation, no anti-tamper code.
- Text: findings and messages never say that the user "is violating" or "is non-compliant".
- Commits: plain `git commit -m "<conventional message>"` as the git user of the repo. No `Co-Authored-By`, no session links, no push (instruction from the owner. It overrides all attribution reminders).
- One line in `DECISIONS.md` for each decision that is not obvious. Legal questions go to `LEGAL_REVIEW.md`.
- Stop after the milestone and wait for the owner.

## Review focus

1. **A key that expires while its 24-hour cache is still new.** The gate must refuse the key after `expiresAt`. It must not continue to operate until the next check. Task 8 tests this ("refuses a cached licence past its expiry").
2. **A `licence.json` that a person edited or that is corrupt, or a key file with CRLF or spaces.** The tool ignores the cache and does not crash. It removes the spaces from the key. Task 8 tests this.
3. **A server and a client that use different capture shapes.** The CLI tells the user to update or to use `--local`. It does not show a zod error dump. Task 9 tests this ("rejects a capture it cannot read").
4. **Chromium crashes or closes between scans.** The next scan starts a new browser. It does not fail for all subsequent scans. Task 5 tests this.
5. **Unusual spellings of local hosts:** `LOCALHOST.`, `app.localhost`, `[::ffff:127.0.0.1]`, `0x7f.1`, `2130706433`. These count as local, and the hosted scanner refuses them. Task 1 (table) and Task 4 (`checkTarget`) test this.

---

### Task 1: Core address classification

**Files:**
- Create: `packages/core/src/net/address.ts`
- Create: `packages/core/src/net/address.test.ts`
- Modify: `packages/core/package.json` (dependency and subpath exports)
- Modify: `packages/core/src/index.ts`
- Modify: `packages/cli/package.json` (dependency, because the CLI bundle does not include the listed dependencies)

**Interfaces:**
- Produces: `isPublicAddress(ip: string): boolean`, `isLocalTarget(hostname: string): boolean`; subpath exports `@legal-lint/core/address`, `@legal-lint/core/crawler`, `@legal-lint/core/remote` (Task 2 adds the last file). Thus the API bundle does not include the TypeScript compiler.

- [x] **Step 1: Add the dependency and subpath exports**

```bash
pnpm --filter @legal-lint/core add ipaddr.js@2.5.0
pnpm --filter legal-lint add ipaddr.js@2.5.0
```

Change the `exports` of `packages/core/package.json` to:

```json
  "exports": {
    ".": "./src/index.ts",
    "./address": "./src/net/address.ts",
    "./crawler": "./src/runtime/crawler.ts",
    "./remote": "./src/remote.ts"
  },
```

- [x] **Step 2: Write the test that fails**

`packages/core/src/net/address.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isLocalTarget, isPublicAddress } from './address.ts';

describe('isPublicAddress', () => {
  const cases: [string, boolean][] = [
    ['8.8.8.8', true],
    ['142.250.72.14', true],
    ['2606:4700:4700::1111', true],
    ['127.0.0.1', false],
    ['127.255.255.254', false],
    ['10.0.0.1', false],
    ['172.16.5.4', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false], // cloud metadata
    ['100.64.0.1', false], // carrier-grade NAT
    ['0.0.0.0', false],
    ['224.0.0.1', false],
    ['255.255.255.255', false],
    ['192.0.2.1', false], // documentation, reserved
    ['::1', false],
    ['::', false],
    ['fe80::1', false],
    ['fc00::1', false],
    ['fd20:abcd::1', false], // unique-local, used for internal networks
    ['ff02::1', false],
    ['::ffff:127.0.0.1', false], // IPv4-mapped loopback
    ['::ffff:8.8.8.8', true],
    ['2002:7f00:1::', false], // 6to4 wrapping 127.0.0.1
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', false], // Teredo
    ['64:ff9b::7f00:1', false], // NAT64 of 127.0.0.1
    ['[::1]', false],
    ['not-an-ip', false],
    ['', false],
  ];
  for (const [ip, expected] of cases) {
    it(`${ip || '(empty)'} → ${expected ? 'public' : 'refused'}`, () => {
      expect(isPublicAddress(ip)).toBe(expected);
    });
  }
});

describe('isLocalTarget', () => {
  // Hostnames as new URL(...).hostname gives them, so odd IPv4 spellings arrive normalised.
  const host = (url: string) => new URL(url).hostname;
  const cases: [string, boolean][] = [
    ['http://localhost:3000/', true],
    ['http://LOCALHOST./', true],
    ['http://app.localhost/', true],
    ['http://127.0.0.1:8080/', true],
    ['http://0x7f.1/', true],
    ['http://2130706433/', true],
    ['http://[::1]:3000/', true],
    ['http://[::ffff:127.0.0.1]/', true],
    ['http://192.168.1.20:5173/', true],
    ['https://example.com/', false],
    ['https://8.8.8.8/', false],
    ['https://localhost.example.com/', false],
  ];
  for (const [url, expected] of cases) {
    it(`${url} → ${expected ? 'local' : 'remote'}`, () => {
      expect(isLocalTarget(host(url))).toBe(expected);
    });
  }
});
```

- [x] **Step 3: Run the test and make sure that it fails**

Run: `pnpm vitest run packages/core/src/net/address.test.ts`
Expected: FAIL. The test cannot find `./address.ts`.

- [x] **Step 4: Write the code**

`packages/core/src/net/address.ts`:

```ts
import ipaddr from 'ipaddr.js';

function bare(host: string): string {
  return host.replace(/^\[|\]$/g, '');
}

/**
 * True only for a public unicast address. Loopback, private, link-local (where
 * cloud metadata servers live), unique-local, carrier-grade NAT, multicast,
 * reserved ranges, and IPv4 addresses wrapped in IPv6 are all refused.
 */
export function isPublicAddress(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(bare(ip));
  } catch {
    return false;
  }
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6;
    // ::ffff:10.0.0.1 and friends: judge the IPv4 address inside.
    if (v6.isIPv4MappedAddress()) return isPublicAddress(v6.toIPv4Address().toString());
    // Global unicast is 2000::/3. ipaddr.js calls everything it has no name for "unicast".
    if (!v6.match(ipaddr.IPv6.parse('2000::'), 3)) return false;
  }
  return addr.range() === 'unicast';
}

/** True for hostnames that only make sense on the user's own machine or network. */
export function isLocalTarget(hostname: string): boolean {
  const host = bare(hostname).toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  return ipaddr.isValid(host) && !isPublicAddress(host);
}
```

Add to `packages/core/src/index.ts`:

```ts
export { isLocalTarget, isPublicAddress } from './net/address.ts';
```

- [x] **Step 5: Run the tests**

Run: `pnpm vitest run packages/core/src/net/address.test.ts`
Expected: PASS. If a row fails, find what `ipaddr.js` returns for it (`node -e "console.log(require('ipaddr.js').parse('…').range())"` from `packages/core`). Correct the classifier, not the table.

- [x] **Step 6: Commit**

```bash
git add packages/core packages/cli/package.json pnpm-lock.yaml
git commit -m "feat(core): classify public and local addresses for the hosted scanner"
```

---

### Task 2: Wire format, crawl budget, and refusal of a key in the project config

**Files:**
- Create: `packages/core/src/remote.ts`
- Create: `packages/core/src/remote.test.ts`
- Modify: `packages/core/src/runtime/crawler.ts` (`budgetMs`)
- Modify: `packages/core/src/schemas.ts:93` (`licenceKey`)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/engine.test.ts` (refusal of the config)

**Interfaces:**
- Consumes: `SiteCapture` from `packages/core/src/types.ts`.
- Produces: `siteCaptureSchema`, `licenceRequestSchema`, `licenceResponseSchema`, `scanRequestSchema`, `scanResponseSchema`, `apiErrorSchema`, `API_ERROR_REASONS`, and types `LicenceResponse`, `ApiErrorReason`. `CaptureOptions.budgetMs?: number`.

- [x] **Step 1: Write the tests that fail**

`packages/core/src/remote.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { apiErrorSchema, licenceRequestSchema, licenceResponseSchema, scanResponseSchema, siteCaptureSchema } from './remote.ts';
import type { SiteCapture } from './types.ts';

const capture: SiteCapture = {
  startUrl: 'https://example.com/',
  userAgent: 'ua',
  pages: [
    {
      url: 'https://example.com/',
      finalUrl: 'https://example.com/',
      status: 200,
      requests: [{ url: 'https://fonts.googleapis.com/css2?family=Inter', method: 'GET', resourceType: 'stylesheet', msSinceNavigation: 12 }],
      cookies: [{ name: 'a', domain: 'example.com', path: '/' }],
      text: 'Hello',
      html: '<p>Hello</p>',
      links: [{ href: 'https://example.com/pricing', text: 'Pricing' }],
    },
    { url: 'https://example.com/x', finalUrl: 'https://example.com/x', status: null, requests: [], cookies: [], text: '', html: '', links: [], error: 'timeout' },
  ],
};

describe('wire format', () => {
  it('round-trips a capture unchanged', () => {
    expect(scanResponseSchema.parse(JSON.parse(JSON.stringify({ capture })))).toEqual({ capture });
  });

  it('rejects a capture with no pages or a missing field', () => {
    expect(siteCaptureSchema.safeParse({ ...capture, pages: [] }).success).toBe(false);
    const { html: _drop, ...page } = capture.pages[0]!;
    expect(siteCaptureSchema.safeParse({ ...capture, pages: [page] }).success).toBe(false);
  });

  it('accepts only key and version in a licence request', () => {
    expect(licenceRequestSchema.safeParse({ key: 'll_x', version: '0.1.0' }).success).toBe(true);
    expect(licenceRequestSchema.safeParse({ key: 'll_x', version: '0.1.0', path: '/repo' }).success).toBe(false);
  });

  it('parses both licence answers and an error body', () => {
    expect(licenceResponseSchema.parse({ valid: true, expiresAt: null })).toEqual({ valid: true, expiresAt: null });
    expect(licenceResponseSchema.parse({ valid: false, reason: 'revoked' })).toEqual({ valid: false, reason: 'revoked' });
    expect(licenceResponseSchema.safeParse({ valid: false, reason: 'nope' }).success).toBe(false);
    expect(apiErrorSchema.parse({ error: { reason: 'monthly_budget', message: 'm' } }).error.reason).toBe('monthly_budget');
  });
});
```

Add to the end of `packages/core/src/engine.test.ts`. The file already imports from `vitest`. Add the missing imports at the top, for example `mkdtemp`, `writeFile`, `tmpdir`, `path`, `loadConfig`, `ConfigError`:

```ts
describe('licenceKey in the project config', () => {
  it('is refused with a message saying where the key belongs', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-cfg-'));
    await writeFile(path.join(dir, 'legal-lint.config.json'), JSON.stringify({ licenceKey: 'll_abc' }));
    await expect(loadConfig(dir)).rejects.toThrow(/LEGAL_LINT_KEY|legal-lint activate/);
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigError);
  });
});
```

- [x] **Step 2: Run the tests and make sure that they fail**

Run: `pnpm vitest run packages/core/src/remote.test.ts packages/core/src/engine.test.ts`
Expected: FAIL. `remote.ts` is missing, and the schema accepts `licenceKey`.

- [x] **Step 3: Write the code**

`packages/core/src/remote.ts`:

```ts
import { z } from 'zod';
import type { SiteCapture } from './types.ts';

// What travels between the CLI and the hosted API. The request schemas are
// strict, so nothing beyond the key, the version and the URL can be added by accident.

export const siteCaptureSchema: z.ZodType<SiteCapture> = z.object({
  startUrl: z.string(),
  userAgent: z.string(),
  pages: z
    .array(
      z.object({
        url: z.string(),
        finalUrl: z.string(),
        status: z.number().int().nullable(),
        requests: z.array(z.object({ url: z.string(), method: z.string(), resourceType: z.string(), msSinceNavigation: z.number() })),
        cookies: z.array(z.object({ name: z.string(), domain: z.string(), path: z.string() })),
        text: z.string(),
        html: z.string(),
        links: z.array(z.object({ href: z.string(), text: z.string() })),
        error: z.string().optional(),
      }),
    )
    .min(1),
});

export const licenceRequestSchema = z.object({ key: z.string().min(1).max(200), version: z.string().min(1).max(50) }).strict();

export const licenceResponseSchema = z.union([
  z.object({ valid: z.literal(true), expiresAt: z.string().nullable() }),
  z.object({ valid: z.literal(false), reason: z.enum(['unknown', 'revoked', 'expired']) }),
]);

export const scanRequestSchema = z.object({ url: z.string().min(1).max(2048), version: z.string().min(1).max(50) }).strict();

export const scanResponseSchema = z.object({ capture: siteCaptureSchema });

export const API_ERROR_REASONS = [
  'bad_request',
  'bad_url',
  'private_address',
  'unauthorized',
  'too_many_requests',
  'key_hour',
  'key_day',
  'monthly_budget',
  'busy',
  'scan_failed',
  'internal',
] as const;

export const apiErrorSchema = z.object({ error: z.object({ reason: z.enum(API_ERROR_REASONS), message: z.string() }) });

export type LicenceResponse = z.infer<typeof licenceResponseSchema>;
export type ApiErrorReason = (typeof API_ERROR_REASONS)[number];
```

In `packages/core/src/schemas.ts`, replace `licenceKey: z.string().optional(),` with:

```ts
  // The config is committed, so a key here would leak. Refused with directions instead.
  licenceKey: z
    .never({
      error: 'Remove licenceKey: this file is committed, so the key would leak. Set LEGAL_LINT_KEY or run `legal-lint activate <key>` instead.',
    })
    .optional(),
```

In `packages/core/src/runtime/crawler.ts`, add this to `CaptureOptions`:

```ts
  /** Stop starting new pages once this many milliseconds have passed since the crawl began. The hosted API uses it to cap a scan's cost. */
  budgetMs?: number;
```

Then change the follow loop in `captureSite`:

```ts
    const started = Date.now();
    const start = await capturePage(context, url, timeout, offline);
    const pages = [start];
    if (!start.error) {
      for (const next of pickFollowLinks(start, (opts.maxPages ?? 5) - 1)) {
        if (opts.budgetMs !== undefined && Date.now() - started >= opts.budgetMs) break;
        pages.push(await capturePage(context, next, timeout, offline));
      }
    }
```

Add to `packages/core/src/index.ts`:

```ts
export {
  API_ERROR_REASONS,
  apiErrorSchema,
  licenceRequestSchema,
  licenceResponseSchema,
  scanRequestSchema,
  scanResponseSchema,
  siteCaptureSchema,
  type ApiErrorReason,
  type LicenceResponse,
} from './remote.ts';
```

- [x] **Step 4: Run the tests and the typecheck**

Run: `pnpm vitest run packages/core && pnpm typecheck`
Expected: PASS. If `z.never({ error })` does not give the message in zod 4.6.5, use `z.unknown().refine(() => false, { message: '…' }).optional()`. Write this in DECISIONS.md.

- [x] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add the API wire format, a crawl time budget, and refuse licence keys in the project config"
```

---

### Task 3: API package, keys, stores and limiters

**Files:**
- Create: `packages/api/package.json`, `packages/api/tsup.config.ts`
- Create: `packages/api/src/keys.ts`, `packages/api/src/store.ts`, `packages/api/src/limits.ts`
- Create: `packages/api/src/store-contract.ts` (shared store tests. The Firestore store in Task 7 also uses them. It is not a `.test.ts` file, thus it never runs alone.)
- Test: `packages/api/src/keys.test.ts`, `packages/api/src/store.test.ts`, `packages/api/src/limits.test.ts`

**Interfaces:**
- Produces:
  - `KEY_PATTERN`, `generateKey(): string`, `hashKey(key): string`, `keyPrefix(key): string`, `issueKey(label: string, expiresAt: string | null, now: Date): { key: string; hash: string; record: KeyRecord }`, `checkKey(store: KeyStore, key: string, now: Date): Promise<KeyCheck>`
  - `interface KeyRecord { prefix: string; label: string; createdAt: string; expiresAt: string | null; revokedAt: string | null }`
  - `type KeyCheck = { valid: true; hash: string; record: KeyRecord } | { valid: false; reason: 'unknown' | 'revoked' | 'expired' }`
  - `interface KeyStore { get(hash: string): Promise<KeyRecord | null>; put(hash: string, record: KeyRecord): Promise<void>; list(): Promise<(KeyRecord & { hash: string })[]>; revoke(prefix: string, at: Date): Promise<number> }`
  - `interface ScanLimits { perKeyHour: number; perKeyDay: number; perMonth: number }`
  - `type Reservation = { ok: true } | { ok: false; reason: 'key_hour' | 'key_day' | 'monthly_budget'; retryAfterSec: number }`
  - `interface UsageStore { reserveScan(keyHash: string, now: Date, limits: ScanLimits): Promise<Reservation> }`
  - `windowIds(now)`, `secondsUntilNext(now, unit)`, `decide(counts, limits, now)`, `class MemoryStore implements KeyStore, UsageStore`
  - `class FixedWindowLimiter { constructor(limit: number, windowMs: number); hit(id, now): { ok: true } | { ok: false; retryAfterSec: number }; blocked(id, now): boolean }`
  - `class ScanQueue { constructor(maxRunning: number, maxWaiting: number); run<T>(fn: () => Promise<T>): Promise<T> }`, `class BusyError`
  - `clientIp(forwardedFor: string | undefined, trustedHops: number): string`

- [x] **Step 1: Make the basic files of the package**

`packages/api/package.json`:

```json
{
  "name": "@legal-lint/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsup",
    "start": "node dist/server.js",
    "admin": "node dist/admin.js"
  },
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    "@google-cloud/firestore": "9.3.1",
    "@hono/node-server": "2.1.3",
    "hono": "4.13.13",
    "ipaddr.js": "2.5.0",
    "playwright": "1.63.0",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@legal-lint/core": "workspace:*",
    "tsup": "8.5.1"
  }
}
```

`packages/api/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', admin: 'src/admin-main.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  // Everything is bundled except the two packages the container installs itself:
  // Playwright (with its browser) and Firestore (which loads proto files at runtime).
  noExternal: [/^@legal-lint\//, 'hono', /^hono\//, '@hono/node-server', 'zod', 'ipaddr.js'],
  external: ['playwright', '@google-cloud/firestore'],
});
```

Run: `pnpm install`
Expected: the lockfile now contains `packages/api`.

- [x] **Step 2: Write the tests that fail**

`packages/api/src/keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkKey, generateKey, hashKey, issueKey, KEY_PATTERN, keyPrefix } from './keys.ts';
import { MemoryStore } from './store.ts';

const NOW = new Date('2026-10-07T12:00:00Z');

describe('keys', () => {
  it('generates distinct keys in the documented format', () => {
    const keys = new Set(Array.from({ length: 200 }, generateKey));
    expect(keys.size).toBe(200);
    for (const k of keys) expect(k).toMatch(KEY_PATTERN);
  });

  it('hashes stably and keeps an 8-character prefix', () => {
    const k = 'll_0123456789abcdefghijklmnopqrstuv';
    expect(hashKey(k)).toBe(hashKey(k));
    expect(hashKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(keyPrefix(k)).toBe('ll_01234');
  });

  it('issues a record that does not contain the key', () => {
    const { key, hash, record } = issueKey('founder@example.com', null, NOW);
    expect(hash).toBe(hashKey(key));
    expect(JSON.stringify(record)).not.toContain(key);
    expect(record).toEqual({ prefix: keyPrefix(key), label: 'founder@example.com', createdAt: NOW.toISOString(), expiresAt: null, revokedAt: null });
  });

  it('answers valid, unknown, revoked and expired', async () => {
    const store = new MemoryStore();
    const ok = issueKey('a', null, NOW);
    const old = issueKey('b', '2026-10-07T12:00:00.000Z', NOW);
    const gone = issueKey('c', null, NOW);
    for (const k of [ok, old, gone]) await store.put(k.hash, k.record);
    await store.revoke(gone.record.prefix, NOW);

    expect(await checkKey(store, ok.key, NOW)).toMatchObject({ valid: true, hash: ok.hash });
    expect(await checkKey(store, generateKey(), NOW)).toEqual({ valid: false, reason: 'unknown' });
    expect(await checkKey(store, 'not a key', NOW)).toEqual({ valid: false, reason: 'unknown' });
    expect(await checkKey(store, gone.key, NOW)).toEqual({ valid: false, reason: 'revoked' });
    // Expiry is exclusive: at the stored instant the key no longer works.
    expect(await checkKey(store, old.key, NOW)).toEqual({ valid: false, reason: 'expired' });
    expect(await checkKey(store, old.key, new Date(NOW.getTime() - 1))).toMatchObject({ valid: true });
  });
});
```

`packages/api/src/store-contract.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { KeyStore, UsageStore } from './store.ts';

export const LIMITS = { perKeyHour: 2, perKeyDay: 3, perMonth: 4 };

/** The same contract runs against Firestore when the emulator is available (Task 7). */
export function storeContract(name: string, make: () => Promise<KeyStore & UsageStore>) {
  describe(`${name} store`, () => {
    it('stores, lists and revokes keys by prefix', async () => {
      const store = await make();
      const id = randomUUID().slice(0, 5);
      const rec = { prefix: `ll_${id}`, label: 'x', createdAt: '2026-10-07T00:00:00.000Z', expiresAt: null, revokedAt: null };
      await store.put(`hash-${id}`, rec);
      expect(await store.get(`hash-${id}`)).toEqual(rec);
      expect(await store.get(`missing-${id}`)).toBeNull();
      expect((await store.list()).some((r) => r.hash === `hash-${id}`)).toBe(true);
      expect(await store.revoke(`ll_${id}`, new Date('2026-10-08T00:00:00Z'))).toBe(1);
      expect((await store.get(`hash-${id}`))?.revokedAt).toBe('2026-10-08T00:00:00.000Z');
      expect(await store.revoke(`ll_${id}`, new Date())).toBe(0);
    });

    it('counts scans per key hour, key day and service month', async () => {
      const store = await make();
      // A unique year per run keeps the global month counter separate between runs.
      const year = 3000 + Math.floor(Math.random() * 5000);
      const at = (iso: string) => new Date(`${year}-${iso}Z`);
      const a = `key-a-${randomUUID()}`;
      const b = `key-b-${randomUUID()}`;
      expect(await store.reserveScan(a, at('03-10T10:00:00'), LIMITS)).toEqual({ ok: true });
      expect(await store.reserveScan(a, at('03-10T10:30:00'), LIMITS)).toEqual({ ok: true });
      expect(await store.reserveScan(a, at('03-10T10:59:00'), LIMITS)).toEqual({ ok: false, reason: 'key_hour', retryAfterSec: 60 });
      expect(await store.reserveScan(a, at('03-10T11:00:00'), LIMITS)).toEqual({ ok: true });
      expect(await store.reserveScan(a, at('03-10T12:00:00'), LIMITS)).toMatchObject({ ok: false, reason: 'key_day' });
      expect(await store.reserveScan(b, at('03-11T09:00:00'), LIMITS)).toEqual({ ok: true });
      // Month total is now 4 across both keys.
      expect(await store.reserveScan(b, at('03-11T09:10:00'), LIMITS)).toMatchObject({ ok: false, reason: 'monthly_budget' });
      expect(await store.reserveScan(b, at('04-01T00:00:00'), LIMITS)).toEqual({ ok: true });
    });
  });
}
```

`packages/api/src/store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decide, MemoryStore, secondsUntilNext, windowIds } from './store.ts';
import { LIMITS, storeContract } from './store-contract.ts';

storeContract('memory', async () => new MemoryStore());

describe('window helpers', () => {
  it('names UTC windows', () => {
    expect(windowIds(new Date('2026-10-07T05:06:07Z'))).toEqual({ hour: '2026-10-07T05', day: '2026-10-07', month: '2026-10' });
  });

  it('counts seconds to the next window, never zero', () => {
    const t = new Date('2026-12-31T23:59:30Z');
    expect(secondsUntilNext(t, 'hour')).toBe(30);
    expect(secondsUntilNext(t, 'day')).toBe(30);
    expect(secondsUntilNext(t, 'month')).toBe(30);
    expect(secondsUntilNext(new Date('2026-10-07T00:00:00Z'), 'hour')).toBe(3600);
  });

  it('checks the month before the key limits', () => {
    const t = new Date('2026-10-07T00:00:00Z');
    expect(decide({ hour: 9, day: 9, month: 4 }, LIMITS, t)).toMatchObject({ reason: 'monthly_budget' });
    expect(decide({ hour: 9, day: 3, month: 0 }, LIMITS, t)).toMatchObject({ reason: 'key_day' });
    expect(decide({ hour: 2, day: 0, month: 0 }, LIMITS, t)).toMatchObject({ reason: 'key_hour' });
    expect(decide({ hour: 1, day: 2, month: 3 }, LIMITS, t)).toEqual({ ok: true });
  });
});
```

`packages/api/src/limits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BusyError, clientIp, FixedWindowLimiter, ScanQueue } from './limits.ts';

describe('FixedWindowLimiter', () => {
  it('allows the limit per window per id, then reports when to retry', () => {
    const l = new FixedWindowLimiter(2, 60_000);
    const t = new Date('2026-10-07T00:00:10Z');
    expect(l.hit('a', t)).toEqual({ ok: true });
    expect(l.hit('a', t)).toEqual({ ok: true });
    expect(l.blocked('a', t)).toBe(true);
    expect(l.hit('a', t)).toEqual({ ok: false, retryAfterSec: 50 });
    expect(l.hit('b', t)).toEqual({ ok: true });
    expect(l.hit('a', new Date('2026-10-07T00:01:00Z'))).toEqual({ ok: true });
  });
});

describe('ScanQueue', () => {
  it('runs up to maxRunning, queues up to maxWaiting, and refuses the rest', async () => {
    const q = new ScanQueue(1, 1);
    let release!: () => void;
    const first = q.run(() => new Promise<string>((r) => (release = () => r('first'))));
    const second = q.run(async () => 'second');
    await expect(q.run(async () => 'third')).rejects.toBeInstanceOf(BusyError);
    release();
    expect(await first).toBe('first');
    expect(await second).toBe('second');
    expect(await q.run(async () => 'fourth')).toBe('fourth');
  });

  it('frees the slot when a job throws', async () => {
    const q = new ScanQueue(1, 0);
    await expect(q.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await q.run(async () => 'ok')).toBe('ok');
  });
});

describe('clientIp', () => {
  it('takes the entry the trusted proxy appended, ignoring what the client prepended', () => {
    expect(clientIp('6.6.6.6, 203.0.113.9', 1)).toBe('203.0.113.9');
    expect(clientIp('6.6.6.6, 203.0.113.9, 10.0.0.1', 2)).toBe('203.0.113.9');
    expect(clientIp(undefined, 1)).toBe('unknown');
    expect(clientIp('', 1)).toBe('unknown');
  });
});
```

- [x] **Step 3: Run the tests and make sure that they fail**

Run: `pnpm vitest run packages/api`
Expected: FAIL. The modules are missing.

- [x] **Step 4: Write the code**

`packages/api/src/keys.ts`:

```ts
import { createHash, randomInt } from 'node:crypto';
import type { KeyStore } from './store.ts';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** ll_ plus 32 base62 characters, about 190 bits. */
export const KEY_PATTERN = /^ll_[0-9A-Za-z]{32}$/;

export interface KeyRecord {
  /** First 8 characters of the key, for listing and revoking. */
  prefix: string;
  /** Who the key is for. */
  label: string;
  createdAt: string;
  /** The key stops working at this instant. null: never. */
  expiresAt: string | null;
  revokedAt: string | null;
}

export type KeyCheck = { valid: true; hash: string; record: KeyRecord } | { valid: false; reason: 'unknown' | 'revoked' | 'expired' };

export function generateKey(): string {
  let key = 'll_';
  for (let i = 0; i < 32; i++) key += ALPHABET[randomInt(ALPHABET.length)];
  return key;
}

/** The store keeps only this hash, so a leaked database does not leak working keys. */
export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function keyPrefix(key: string): string {
  return key.slice(0, 8);
}

export function issueKey(label: string, expiresAt: string | null, now: Date): { key: string; hash: string; record: KeyRecord } {
  const key = generateKey();
  return {
    key,
    hash: hashKey(key),
    record: { prefix: keyPrefix(key), label, createdAt: now.toISOString(), expiresAt, revokedAt: null },
  };
}

export async function checkKey(store: KeyStore, key: string, now: Date): Promise<KeyCheck> {
  if (!KEY_PATTERN.test(key)) return { valid: false, reason: 'unknown' };
  const hash = hashKey(key);
  const record = await store.get(hash);
  if (!record) return { valid: false, reason: 'unknown' };
  if (record.revokedAt) return { valid: false, reason: 'revoked' };
  if (record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()) return { valid: false, reason: 'expired' };
  return { valid: true, hash, record };
}
```

`packages/api/src/store.ts`:

```ts
import type { KeyRecord } from './keys.ts';

export interface KeyStore {
  get(hash: string): Promise<KeyRecord | null>;
  put(hash: string, record: KeyRecord): Promise<void>;
  list(): Promise<(KeyRecord & { hash: string })[]>;
  /** Revokes every live key with this prefix. Returns how many. */
  revoke(prefix: string, at: Date): Promise<number>;
}

export interface ScanLimits {
  perKeyHour: number;
  perKeyDay: number;
  /** For the whole service, to stay inside the free compute quota. */
  perMonth: number;
}

export type Reservation = { ok: true } | { ok: false; reason: 'key_hour' | 'key_day' | 'monthly_budget'; retryAfterSec: number };

export interface UsageStore {
  /** Counts one scan if every limit allows it, atomically. */
  reserveScan(keyHash: string, now: Date, limits: ScanLimits): Promise<Reservation>;
}

/** Fixed UTC windows: simple to count, and the same in every store. */
export function windowIds(now: Date): { hour: string; day: string; month: string } {
  const iso = now.toISOString();
  return { hour: iso.slice(0, 13), day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

export function secondsUntilNext(now: Date, unit: 'hour' | 'day' | 'month'): number {
  const next = new Date(now);
  if (unit === 'hour') next.setUTCMinutes(60, 0, 0);
  else if (unit === 'day') next.setUTCHours(24, 0, 0, 0);
  else {
    next.setUTCMonth(next.getUTCMonth() + 1, 1);
    next.setUTCHours(0, 0, 0, 0);
  }
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

/** The month is checked first: when the service budget is gone, no key can help. */
export function decide(counts: { hour: number; day: number; month: number }, limits: ScanLimits, now: Date): Reservation {
  if (counts.month >= limits.perMonth) return { ok: false, reason: 'monthly_budget', retryAfterSec: secondsUntilNext(now, 'month') };
  if (counts.day >= limits.perKeyDay) return { ok: false, reason: 'key_day', retryAfterSec: secondsUntilNext(now, 'day') };
  if (counts.hour >= limits.perKeyHour) return { ok: false, reason: 'key_hour', retryAfterSec: secondsUntilNext(now, 'hour') };
  return { ok: true };
}

/** Usage document ids, shared with the Firestore store. */
export function usageDocIds(keyHash: string, now: Date): { hour: string; day: string; month: string } {
  const w = windowIds(now);
  return { hour: `${keyHash}_${w.hour}`, day: `${keyHash}_${w.day}`, month: `month_${w.month}` };
}

/** For tests and local runs. */
export class MemoryStore implements KeyStore, UsageStore {
  private readonly keys = new Map<string, KeyRecord>();
  private readonly counts = new Map<string, number>();

  async get(hash: string): Promise<KeyRecord | null> {
    return this.keys.get(hash) ?? null;
  }

  async put(hash: string, record: KeyRecord): Promise<void> {
    this.keys.set(hash, record);
  }

  async list(): Promise<(KeyRecord & { hash: string })[]> {
    return [...this.keys].map(([hash, record]) => ({ hash, ...record }));
  }

  async revoke(prefix: string, at: Date): Promise<number> {
    let n = 0;
    for (const [hash, record] of this.keys) {
      if (record.prefix !== prefix || record.revokedAt) continue;
      this.keys.set(hash, { ...record, revokedAt: at.toISOString() });
      n++;
    }
    return n;
  }

  async reserveScan(keyHash: string, now: Date, limits: ScanLimits): Promise<Reservation> {
    const ids = usageDocIds(keyHash, now);
    const count = (id: string) => this.counts.get(id) ?? 0;
    const decision = decide({ hour: count(ids.hour), day: count(ids.day), month: count(ids.month) }, limits, now);
    if (decision.ok) for (const id of Object.values(ids)) this.counts.set(id, count(id) + 1);
    return decision;
  }
}
```

`packages/api/src/limits.ts`:

```ts
/** In memory, which is correct because the service runs as a single instance. */
export class FixedWindowLimiter {
  private readonly hits = new Map<string, { window: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  hit(id: string, now: Date): { ok: true } | { ok: false; retryAfterSec: number } {
    const window = Math.floor(now.getTime() / this.windowMs);
    const current = this.hits.get(id);
    const count = current?.window === window ? current.count + 1 : 1;
    this.hits.set(id, { window, count });
    if (this.hits.size > 10_000) this.prune(window);
    if (count <= this.limit) return { ok: true };
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(((window + 1) * this.windowMs - now.getTime()) / 1000)) };
  }

  /** True when this id has used up the current window. Does not count a hit. */
  blocked(id: string, now: Date): boolean {
    const current = this.hits.get(id);
    return current?.window === Math.floor(now.getTime() / this.windowMs) && current.count >= this.limit;
  }

  private prune(window: number): void {
    for (const [id, entry] of this.hits) if (entry.window !== window) this.hits.delete(id);
  }
}

export class BusyError extends Error {}

/** At most maxRunning jobs at once and maxWaiting in line; anything more is refused at once. */
export class ScanQueue {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly maxRunning: number,
    private readonly maxWaiting: number,
  ) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.running < this.maxRunning) {
      this.running++;
    } else {
      if (this.waiting.length >= this.maxWaiting) throw new BusyError('All scan slots are busy.');
      // The finishing job hands its slot over, so `running` stays the same.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}

/**
 * The client address from X-Forwarded-For. Proxies append, clients can only
 * prepend, so count `trustedHops` entries from the right.
 */
export function clientIp(forwardedFor: string | undefined, trustedHops: number): string {
  const parts = (forwardedFor ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - trustedHops] ?? 'unknown';
}
```

- [x] **Step 5: Run the tests**

Run: `pnpm vitest run packages/api && pnpm typecheck`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/api pnpm-lock.yaml
git commit -m "feat(api): add licence keys stored as hashes, scan usage limits and request limiters"
```

---

### Task 4: Target check and egress proxy

**Files:**
- Create: `packages/api/src/egress/target.ts`, `packages/api/src/egress/proxy.ts`
- Test: `packages/api/src/egress/target.test.ts`, `packages/api/src/egress/proxy.test.ts`

**Interfaces:**
- Consumes: `isPublicAddress` from `@legal-lint/core/address`.
- Produces:
  - `type Resolver = (hostname: string) => Promise<string[]>`, `systemResolve: Resolver`
  - `type TargetPolicy = (ip: string, port: number) => boolean`, `publicWebOnly: TargetPolicy`
  - `vetHost(host, port, policy, resolve): Promise<{ ok: true; address: string } | { ok: false; reason: 'unresolvable' | 'refused' }>`
  - `checkTarget(url: string, policy, resolve): Promise<{ ok: true; url: string } | { ok: false; reason: 'bad_url' | 'private_address'; message: string }>`
  - `startEgressProxy({ policy, resolve }): Promise<EgressProxy>` where `interface EgressProxy { url: string; refused: string[]; close(): Promise<void> }`

- [x] **Step 1: Write the tests that fail**

`packages/api/src/egress/target.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkTarget, publicWebOnly, type Resolver } from './target.ts';

const dns: Record<string, string[]> = {
  'example.com': ['93.184.215.14'],
  'metadata.google.internal': ['169.254.169.254'],
  'mixed.test': ['93.184.215.14', '10.0.0.5'],
  'v6.test': ['2606:4700::6810:84e5'],
};
const resolve: Resolver = async (h) => {
  const a = dns[h];
  if (!a) throw new Error(`ENOTFOUND ${h}`);
  return a;
};

describe('checkTarget with the production policy', () => {
  const allowed = ['https://example.com/', 'http://example.com/pricing?x=1', 'https://v6.test/', 'https://8.8.8.8/'];
  for (const url of allowed) {
    it(`allows ${url}`, async () => {
      expect(await checkTarget(url, publicWebOnly, resolve)).toEqual({ ok: true, url: new URL(url).href });
    });
  }

  const privateUrls = [
    'http://127.0.0.1/',
    'http://localhost/',
    'http://LOCALHOST./',
    'http://0x7f.1/',
    'http://2130706433/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://10.0.0.1/',
    'http://169.254.169.254/computeMetadata/v1/',
    'http://metadata.google.internal/',
    'https://mixed.test/', // one private answer is enough to refuse
    'https://example.com:8443/', // non-web port
    'http://8.8.8.8:22/',
  ];
  for (const url of privateUrls) {
    it(`refuses ${url}`, async () => {
      expect(await checkTarget(url, publicWebOnly, resolve)).toMatchObject({ ok: false, reason: 'private_address' });
    });
  }

  const badUrls = ['not a url', 'ftp://example.com/', 'file:///etc/passwd', 'https://user:pw@example.com/', 'https://nowhere.test/'];
  for (const url of badUrls) {
    it(`calls ${url} a bad URL`, async () => {
      expect(await checkTarget(url, publicWebOnly, resolve)).toMatchObject({ ok: false, reason: 'bad_url' });
    });
  }

  it('tells the user to scan locally when refusing', async () => {
    const r = await checkTarget('http://10.0.0.1/', publicWebOnly, resolve);
    expect(r.ok ? '' : r.message).toMatch(/--local/);
  });
});
```

Note: `localhost` is not in `dns`. Thus the refusal must come from `isLocalTarget`, not from the resolver. Write the code in this way.

`packages/api/src/egress/proxy.test.ts`:

```ts
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
```

- [x] **Step 2: Run the tests and make sure that they fail**

Run: `pnpm vitest run packages/api/src/egress`
Expected: FAIL. The modules are missing.

- [x] **Step 3: Write the code**

`packages/api/src/egress/target.ts`:

```ts
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isLocalTarget, isPublicAddress } from '@legal-lint/core/address';

export type Resolver = (hostname: string) => Promise<string[]>;

export const systemResolve: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

/** Decides whether the scanner may connect to an address and port. */
export type TargetPolicy = (ip: string, port: number) => boolean;

/** Production: public unicast addresses on the two web ports only. */
export const publicWebOnly: TargetPolicy = (ip, port) => (port === 80 || port === 443) && isPublicAddress(ip);

export function bareHost(host: string): string {
  return host.replace(/^\[|\]$/g, '');
}

/**
 * Resolves a host and returns an address to connect to only when every address
 * it resolves to is allowed. The caller must connect to that address, not the
 * name, so a second DNS answer cannot swap in an internal one.
 */
export async function vetHost(
  host: string,
  port: number,
  policy: TargetPolicy,
  resolve: Resolver,
): Promise<{ ok: true; address: string } | { ok: false; reason: 'unresolvable' | 'refused' }> {
  const name = bareHost(host);
  let addresses: string[];
  if (isIP(name)) addresses = [name];
  else {
    try {
      addresses = await resolve(name);
    } catch {
      addresses = [];
    }
  }
  if (addresses.length === 0) return { ok: false, reason: 'unresolvable' };
  if (!addresses.every((a) => policy(a, port))) return { ok: false, reason: 'refused' };
  return { ok: true, address: addresses[0]! };
}

export type TargetCheck = { ok: true; url: string } | { ok: false; reason: 'bad_url' | 'private_address'; message: string };

function portOf(url: URL): number {
  return url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
}

/** The first SSRF layer: refuses a scan request before any browser starts. */
export async function checkTarget(raw: string, policy: TargetPolicy, resolve: Resolver): Promise<TargetCheck> {
  const bad = (message: string): TargetCheck => ({ ok: false, reason: 'bad_url', message });
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return bad('Not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return bad('Only http and https URLs can be scanned.');
  if (url.username || url.password) return bad('URLs with a username or password cannot be scanned.');
  const refused: TargetCheck = {
    ok: false,
    reason: 'private_address',
    message: `${url.host} is not a public web address on port 80 or 443, so the hosted scanner will not load it. Scan it on your own machine with --local.`,
  };
  if (isLocalTarget(url.hostname)) return refused;
  const vetted = await vetHost(url.hostname, portOf(url), policy, resolve);
  if (!vetted.ok) return vetted.reason === 'unresolvable' ? bad(`Could not resolve ${url.hostname}.`) : refused;
  return { ok: true, url: url.href };
}
```

`packages/api/src/egress/proxy.ts`:

```ts
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { bareHost, vetHost, type Resolver, type TargetPolicy } from './target.ts';

export interface EgressProxy {
  /** http://127.0.0.1:<port>, for Chromium's proxy setting. */
  url: string;
  /** host:port of every connection refused, for tests and logs. */
  refused: string[];
  close(): Promise<void>;
}

/** "example.com:443" or "[::1]:443". */
function splitAuthority(authority: string): { host: string; port: number } | null {
  const m = /^(?:\[([^\]]+)\]|([^:\s]+)):(\d{1,5})$/.exec(authority);
  if (!m) return null;
  return { host: m[1] ?? m[2]!, port: Number(m[3]) };
}

function hostPort(host: string, port: number): string {
  const bare = bareHost(host);
  return net.isIPv6(bare) ? `[${bare}]:${port}` : `${bare}:${port}`;
}

/**
 * The second SSRF layer. Every connection Chromium makes (navigations,
 * redirects, subresources, iframes, websockets) comes through here. The proxy
 * resolves the name itself, checks every address, and connects to the address
 * it checked.
 */
export async function startEgressProxy(opts: { policy: TargetPolicy; resolve: Resolver }): Promise<EgressProxy> {
  const refused: string[] = [];
  const sockets = new Set<net.Socket>();
  const track = (s: net.Socket) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  };
  const vet = async (host: string, port: number) => {
    const result = await vetHost(host, port, opts.policy, opts.resolve);
    if (!result.ok) refused.push(hostPort(host, port));
    return result;
  };

  // Plain http:// requests arrive with an absolute URL.
  const server = http.createServer(async (req, res) => {
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== 'http:') {
      res.writeHead(400).end();
      return;
    }
    const port = target.port ? Number(target.port) : 80;
    const vetted = await vet(target.hostname, port);
    if (!vetted.ok) {
      res.writeHead(403).end();
      return;
    }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    const upstream = http.request({
      host: vetted.address,
      port,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
      setHost: false,
    });
    upstream.on('response', (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  const tunnel = async (host: string, port: number, client: net.Socket, onOpen: (upstream: net.Socket) => void) => {
    track(client);
    client.on('error', () => client.destroy());
    const vetted = await vet(host, port);
    if (!vetted.ok) {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = net.connect(port, vetted.address, () => {
      onOpen(upstream);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    track(upstream);
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
  };

  // https:// and wss:// (and ws:// in Chromium) arrive as CONNECT host:port.
  server.on('connect', (req, client: net.Socket, head: Buffer) => {
    const authority = splitAuthority(req.url ?? '');
    if (!authority) {
      client.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    void tunnel(authority.host, authority.port, client, (upstream) => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
    });
  });

  // ws:// sent as an absolute-URL upgrade request: replay it to the checked address.
  server.on('upgrade', (req, client: net.Socket, head: Buffer) => {
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      client.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const port = target.port ? Number(target.port) : 80;
    void tunnel(target.hostname, port, client, (upstream) => {
      const lines = [`${req.method} ${target.pathname}${target.search} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        if (req.rawHeaders[i]!.toLowerCase() !== 'proxy-connection') lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
    });
  });

  server.on('connection', track);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    refused,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
```

- [x] **Step 4: Run the tests**

Run: `pnpm vitest run packages/api/src/egress && pnpm typecheck`
Expected: PASS. If the `::1` listener fails on this machine, stop and report it. Do not move the internal server to 127.0.0.1. The test needs the two servers on different addresses.

- [x] **Step 5: Commit**

```bash
git add packages/api/src/egress
git commit -m "feat(api): refuse private targets at input and in an egress proxy that connects only to checked addresses"
```

---

### Task 5: Scanner (Chromium behind the proxy) and SSRF tests in the browser

**Files:**
- Create: `packages/api/src/scan.ts`
- Test: `tests/egress.test.ts`

**Interfaces:**
- Consumes: `startEgressProxy`, `TargetPolicy`, `Resolver` (Task 4); `captureSite` from `@legal-lint/core/crawler`.
- Produces: `interface Scanner { scan(url: string): Promise<SiteCapture>; close(): Promise<void>; proxy: EgressProxy }`, `createScanner(opts: { policy: TargetPolicy; resolve: Resolver; toolVersion: string; pageTimeoutMs?: number; budgetMs?: number }): Promise<Scanner>`, `CHROMIUM_ARGS: string[]`.

- [x] **Step 1: Write the test that fails**

`tests/egress.test.ts`:

```ts
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScanner, type Scanner } from '../packages/api/src/scan.ts';
import { publicWebOnly, type Resolver } from '../packages/api/src/egress/target.ts';

// The hosted scanner must never reach an internal address, however the page
// tries: redirect, image, iframe, websocket, or a DNS answer that changes.
// "internal" listens on ::1; the test policy allows only 127.0.0.1.

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
      // The input check would see 127.0.0.1 (call 1); the proxy resolves again (call 2).
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
```

- [x] **Step 2: Run the test and make sure that it fails**

Run: `pnpm vitest run tests/egress.test.ts`
Expected: FAIL. `scan.ts` is missing.

- [x] **Step 3: Write the code**

`packages/api/src/scan.ts`:

```ts
import { chromium, type Browser } from 'playwright';
import { captureSite } from '@legal-lint/core/crawler';
import type { SiteCapture } from '@legal-lint/core';
import { startEgressProxy, type EgressProxy } from './egress/proxy.ts';
import type { Resolver, TargetPolicy } from './egress/target.ts';

/**
 * The third SSRF layer. Playwright's proxy setting adds `<-loopback>` to the
 * bypass list, so localhost also goes through the proxy. These flags keep
 * WebRTC and QUIC from sending anything around it.
 */
export const CHROMIUM_ARGS = ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-quic'];

export interface Scanner {
  scan(url: string): Promise<SiteCapture>;
  close(): Promise<void>;
  proxy: EgressProxy;
  /** Simulates a crashed browser. */
  closeBrowserForTest(): Promise<void>;
}

export async function createScanner(opts: {
  policy: TargetPolicy;
  resolve: Resolver;
  toolVersion: string;
  pageTimeoutMs?: number;
  budgetMs?: number;
}): Promise<Scanner> {
  const proxy = await startEgressProxy({ policy: opts.policy, resolve: opts.resolve });
  let browser: Promise<Browser> | null = null;

  // One browser per instance, launched on first use and again if it dies.
  const getBrowser = async (): Promise<Browser> => {
    if (browser) {
      const b = await browser;
      if (b.isConnected()) return b;
    }
    browser = chromium.launch({ proxy: { server: proxy.url }, args: CHROMIUM_ARGS }).catch((e: unknown) => {
      browser = null;
      throw e;
    });
    return browser;
  };

  return {
    proxy,
    async scan(url) {
      return captureSite(url, {
        browser: await getBrowser(),
        toolVersion: opts.toolVersion,
        timeoutMs: opts.pageTimeoutMs ?? 15_000,
        budgetMs: opts.budgetMs ?? 40_000,
      });
    },
    async closeBrowserForTest() {
      await (await browser)?.close();
    },
    async close() {
      await (await browser?.catch(() => null))?.close();
      await proxy.close();
    },
  };
}
```

- [x] **Step 4: Run the test**

Run: `pnpm vitest run tests/egress.test.ts`
Expected: PASS. If `/ws` reports zero refusals, find if Chromium sent it as CONNECT or as an upgrade. In the two cases, the count of hits on the internal server must stay 0. If it does not stay 0, stop and report.

- [x] **Step 5: Run the test five times to find tests that are not stable**

Run: `for i in 1 2 3 4 5; do pnpm vitest run tests/egress.test.ts || break; done`
Expected: 5 passes. Record each unstable result in the milestone report.

- [x] **Step 6: Commit**

```bash
git add packages/api/src/scan.ts tests/egress.test.ts
git commit -m "feat(api): run Chromium behind the egress proxy and prove internal addresses stay unreachable"
```

---

### Task 6: HTTP app

**Files:**
- Create: `packages/api/src/app.ts`, `packages/api/src/config.ts`
- Test: `packages/api/src/app.test.ts`

**Interfaces:**
- Consumes: Tasks 3 and 4; `licenceRequestSchema`, `scanRequestSchema` from `@legal-lint/core/remote`.
- Produces:
  - `interface ApiConfig { limits: ScanLimits; licenceChecksPerIpHour: number; failedAuthPerIpHour: number; maxRunning: number; maxWaiting: number; trustedHops: number; pageTimeoutMs: number; budgetMs: number; logForwardedFor: boolean }`
  - `readConfig(env: NodeJS.ProcessEnv): ApiConfig`
  - `interface LogEntry { route: string; outcome: string; keyPrefix?: string; host?: string; ms?: number; forwardedFor?: string }`
  - `interface AppDeps { keys: KeyStore; usage: UsageStore; scanner: { scan(url: string): Promise<SiteCapture> }; policy: TargetPolicy; resolve: Resolver; config: ApiConfig; now?: () => Date; log?: (e: LogEntry) => void }`
  - `createApp(deps: AppDeps): Hono`

- [x] **Step 1: Write the test that fails**

`packages/api/src/app.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
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
```

- [x] **Step 2: Run the test and make sure that it fails**

Run: `pnpm vitest run packages/api/src/app.test.ts`
Expected: FAIL. `app.ts` is missing.

- [x] **Step 3: Write the code**

`packages/api/src/config.ts`:

```ts
import type { ScanLimits } from './store.ts';

export interface ApiConfig {
  limits: ScanLimits;
  licenceChecksPerIpHour: number;
  failedAuthPerIpHour: number;
  maxRunning: number;
  maxWaiting: number;
  /** X-Forwarded-For entries added by trusted proxies (checked after the first deploy, DEPLOY.md). */
  trustedHops: number;
  pageTimeoutMs: number;
  budgetMs: number;
  /** Temporary, for finding the client-IP header layout after the first deploy. */
  logForwardedFor: boolean;
}

function int(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Defaults keep a month of worst-case scans at half the Cloud Run free quota (see the spec). */
export function readConfig(env: NodeJS.ProcessEnv): ApiConfig {
  return {
    limits: {
      perKeyHour: int(env.SCANS_PER_KEY_HOUR, 10),
      perKeyDay: int(env.SCANS_PER_KEY_DAY, 50),
      perMonth: int(env.SCANS_PER_MONTH, 1500),
    },
    licenceChecksPerIpHour: int(env.LICENCE_CHECKS_PER_IP_HOUR, 30),
    failedAuthPerIpHour: int(env.FAILED_AUTH_PER_IP_HOUR, 10),
    maxRunning: int(env.MAX_RUNNING_SCANS, 2),
    maxWaiting: int(env.MAX_WAITING_SCANS, 4),
    trustedHops: Math.max(1, int(env.TRUSTED_PROXY_HOPS, 1)),
    pageTimeoutMs: int(env.PAGE_TIMEOUT_MS, 15_000),
    budgetMs: int(env.SCAN_BUDGET_MS, 40_000),
    logForwardedFor: env.LOG_FORWARDED_FOR === '1',
  };
}
```

`packages/api/src/app.ts`:

```ts
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { licenceRequestSchema, scanRequestSchema, type ApiErrorReason } from '@legal-lint/core/remote';
import type { SiteCapture } from '@legal-lint/core';
import type { ApiConfig } from './config.ts';
import { checkTarget, type Resolver, type TargetPolicy } from './egress/target.ts';
import { checkKey, type KeyCheck } from './keys.ts';
import { BusyError, clientIp, FixedWindowLimiter, ScanQueue } from './limits.ts';
import type { KeyStore, UsageStore } from './store.ts';

export interface LogEntry {
  route: string;
  outcome: string;
  keyPrefix?: string;
  host?: string;
  ms?: number;
  forwardedFor?: string;
}

export interface AppDeps {
  keys: KeyStore;
  usage: UsageStore;
  scanner: { scan(url: string): Promise<SiteCapture> };
  policy: TargetPolicy;
  resolve: Resolver;
  config: ApiConfig;
  now?: () => Date;
  log?: (entry: LogEntry) => void;
}

const HOUR = 3_600_000;

export function createApp(deps: AppDeps): Hono {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((entry: LogEntry) => console.log(JSON.stringify(entry)));
  const cfg = deps.config;
  const licenceChecks = new FixedWindowLimiter(cfg.licenceChecksPerIpHour, HOUR);
  const failures = new FixedWindowLimiter(cfg.failedAuthPerIpHour, HOUR);
  const queue = new ScanQueue(cfg.maxRunning, cfg.maxWaiting);

  const fail = (c: Context, status: ContentfulStatusCode, reason: ApiErrorReason, message: string, retryAfterSec?: number) =>
    c.json({ error: { reason, message } }, status, retryAfterSec ? { 'Retry-After': String(retryAfterSec) } : {});
  const ipOf = (c: Context) => clientIp(c.req.header('x-forwarded-for'), cfg.trustedHops);
  const tooMany = (c: Context) => fail(c, 429, 'too_many_requests', 'Too many requests from this address. Try again later.', 3600);
  const bodyOf = async (c: Context) => c.req.json().catch(() => null);

  const app = new Hono();
  app.use('/v1/*', bodyLimit({ maxSize: 4 * 1024, onError: (c) => fail(c, 413, 'bad_request', 'Request body too large.') }));
  app.onError((_e, c) => fail(c, 500, 'internal', 'Something went wrong on the Legal Lint server.'));
  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post('/v1/licence', async (c) => {
    const ip = ipOf(c);
    const t = now();
    if (cfg.logForwardedFor) log({ route: 'licence', outcome: 'debug', forwardedFor: c.req.header('x-forwarded-for') ?? '' });
    if (failures.blocked(ip, t)) return tooMany(c);
    const limited = licenceChecks.hit(ip, t);
    if (!limited.ok) return fail(c, 429, 'too_many_requests', 'Too many licence checks from this address. Try again later.', limited.retryAfterSec);
    const body = licenceRequestSchema.safeParse(await bodyOf(c));
    if (!body.success) return fail(c, 400, 'bad_request', 'Expected {"key","version"} and nothing else.');
    const check = await checkKey(deps.keys, body.data.key, t);
    if (!check.valid) {
      failures.hit(ip, t);
      log({ route: 'licence', outcome: check.reason });
      return c.json({ valid: false, reason: check.reason });
    }
    log({ route: 'licence', outcome: 'valid', keyPrefix: check.record.prefix });
    return c.json({ valid: true, expiresAt: check.record.expiresAt });
  });

  app.post('/v1/scan', async (c) => {
    const started = Date.now();
    const ip = ipOf(c);
    const t = now();
    if (failures.blocked(ip, t)) return tooMany(c);
    const bearer = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '');
    const check: KeyCheck = bearer ? await checkKey(deps.keys, bearer[1]!, t) : { valid: false, reason: 'unknown' };
    if (!check.valid) {
      failures.hit(ip, t);
      log({ route: 'scan', outcome: `key_${check.reason}` });
      const why = check.reason === 'unknown' ? 'missing or not recognised' : check.reason;
      return fail(c, 401, 'unauthorized', `The licence key is ${why}.`);
    }
    const keyPrefix = check.record.prefix;
    const body = scanRequestSchema.safeParse(await bodyOf(c));
    if (!body.success) return fail(c, 400, 'bad_request', 'Expected {"url","version"} and nothing else.');
    const target = await checkTarget(body.data.url, deps.policy, deps.resolve);
    if (!target.ok) {
      log({ route: 'scan', outcome: target.reason, keyPrefix });
      return fail(c, 400, target.reason, target.message);
    }
    const host = new URL(target.url).host;
    const done = (outcome: string) => log({ route: 'scan', outcome, keyPrefix, host, ms: Date.now() - started });

    try {
      return await queue.run(async () => {
        // Counted when Chromium is about to start, since that is when compute is spent.
        const reservation = await deps.usage.reserveScan(check.hash, now(), cfg.limits);
        if (!reservation.ok) {
          done(reservation.reason);
          if (reservation.reason === 'monthly_budget') {
            return fail(c, 503, 'monthly_budget', 'The hosted scanner has used its scans for this month. Scan on your own machine with --local.', reservation.retryAfterSec);
          }
          const window = reservation.reason === 'key_hour' ? 'hourly' : 'daily';
          return fail(c, 429, reservation.reason, `This key has used its ${window} hosted scans. Try later, or scan on your own machine with --local.`, reservation.retryAfterSec);
        }
        try {
          const capture = await deps.scanner.scan(target.url);
          done('ok');
          return c.json({ capture });
        } catch (e) {
          done('scan_failed');
          return fail(c, 502, 'scan_failed', `Could not scan ${host}: ${(e as Error).message.split('\n')[0]}`);
        }
      });
    } catch (e) {
      if (!(e instanceof BusyError)) throw e;
      done('busy');
      return fail(c, 503, 'busy', 'The hosted scanner is busy. Try again in a minute, or scan with --local.', 30);
    }
  });

  return app;
}
```

- [x] **Step 4: Run the tests**

Run: `pnpm vitest run packages/api && pnpm typecheck`
Expected: PASS. If the `c.json(data, status, headers)` overload of Hono refuses `{}` as headers, use `undefined`.

- [x] **Step 5: Commit**

```bash
git add packages/api/src/app.ts packages/api/src/config.ts packages/api/src/app.test.ts
git commit -m "feat(api): add licence and scan endpoints with per-key, per-IP and monthly limits"
```

---

### Task 7: Firestore store, server entry, admin script, container and deploy files

**Files:**
- Create: `packages/api/src/firestore-store.ts`, `packages/api/src/firestore-store.test.ts`
- Create: `packages/api/src/admin.ts`, `packages/api/src/admin-main.ts`, `packages/api/src/admin.test.ts`
- Create: `packages/api/src/server.ts`
- Create: `packages/api/Dockerfile`, `.dockerignore` (repo root), `.gcloudignore` (repo root), `packages/api/cloudbuild.yaml`, `packages/api/cleanup-policy.json`, `packages/api/deploy.sh`, `packages/api/DEPLOY.md`
- Test: `packages/api/src/deploy-files.test.ts`
- Modify: root `package.json` (`build:api` script)

**Interfaces:**
- Consumes: Tasks 3 to 6.
- Produces: `class FirestoreStore implements KeyStore, UsageStore` (the constructor accepts a `Firestore`); `admin(argv: string[], store: KeyStore, out: (s: string) => void, now?: Date): Promise<number>`.

- [x] **Step 1: Write the tests that fail**

`packages/api/src/firestore-store.test.ts`:

```ts
import { Firestore } from '@google-cloud/firestore';
import { describe, it } from 'vitest';
import { FirestoreStore } from './firestore-store.ts';
import { storeContract } from './store-contract.ts';

// Runs only against the Firestore emulator (FIRESTORE_EMULATOR_HOST), never a real project.
if (process.env.FIRESTORE_EMULATOR_HOST) {
  storeContract('firestore', async () => new FirestoreStore(new Firestore({ projectId: 'legal-lint-test' })));
} else {
  describe('firestore store', () => {
    it.skip('needs FIRESTORE_EMULATOR_HOST (see DEPLOY.md, "Testing the Firestore store")', () => {});
  });
}
```

`packages/api/src/admin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { admin } from './admin.ts';
import { hashKey, KEY_PATTERN } from './keys.ts';
import { MemoryStore } from './store.ts';

const NOW = new Date('2026-10-07T12:00:00Z');

async function runAdmin(store: MemoryStore, ...argv: string[]) {
  let out = '';
  const code = await admin(argv, store, (s) => (out += s), NOW);
  return { code, out };
}

describe('admin', () => {
  it('issues a key, prints it once, and stores only its hash', async () => {
    const store = new MemoryStore();
    const { code, out } = await runAdmin(store, 'issue', '--label', 'founder@example.com', '--expires', '2027-01-01');
    expect(code).toBe(0);
    const key = /(ll_[0-9A-Za-z]{32})/.exec(out)![1]!;
    expect(key).toMatch(KEY_PATTERN);
    const [stored] = await store.list();
    expect(stored).toMatchObject({ hash: hashKey(key), label: 'founder@example.com', expiresAt: '2027-01-01T00:00:00.000Z' });
    expect(JSON.stringify(await store.list())).not.toContain(key);
  });

  it('lists keys with status and revokes by prefix', async () => {
    const store = new MemoryStore();
    const { out } = await runAdmin(store, 'issue', '--label', 'a@example.com');
    const prefix = /(ll_[0-9A-Za-z]{5})/.exec(out)![1]!;
    expect((await runAdmin(store, 'list')).out).toMatch(new RegExp(`${prefix}.*a@example.com.*active`));
    expect(await runAdmin(store, 'revoke', prefix)).toEqual({ code: 0, out: `Revoked 1 key with prefix ${prefix}.\n` });
    expect((await runAdmin(store, 'list')).out).toMatch(/revoked/);
  });

  it('refuses bad input with usage and exit 2', async () => {
    const store = new MemoryStore();
    for (const argv of [[], ['issue'], ['issue', '--label', 'x', '--expires', '01/01/2027'], ['revoke'], ['nope']]) {
      const { code, out } = await runAdmin(store, ...argv);
      expect(code, argv.join(' ')).toBe(2);
      expect(out).toMatch(/Usage/);
    }
  });
});
```

`packages/api/src/deploy-files.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The cost limits live in these files. A change that loosens one should fail a test, not show up on a bill.
const dir = path.resolve(import.meta.dirname, '..');
const read = (f: string) => readFileSync(path.join(dir, f), 'utf8');
const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };

describe('deploy files', () => {
  it('the image installs the same Playwright and Firestore versions as package.json', () => {
    const docker = read('Dockerfile');
    expect(docker).toContain(`playwright@${pkg.dependencies.playwright}`);
    expect(docker).toContain(`@google-cloud/firestore@${pkg.dependencies['@google-cloud/firestore']}`);
    expect(docker).toContain('--only-shell');
  });

  it('deploys with the free-tier limits', () => {
    const deploy = read('deploy.sh');
    for (const flag of ['--max-instances 1', '--min-instances 0', '--cpu 1', '--memory 2Gi', '--timeout 120', '--cpu-throttling', '--region "$REGION"']) {
      expect(deploy).toContain(flag);
    }
    expect(deploy).toContain('REGION=us-central1');
  });

  it('keeps only the latest image', () => {
    expect(JSON.parse(read('cleanup-policy.json'))).toEqual([
      { name: 'keep-latest', action: { type: 'Keep' }, mostRecentVersions: { keepCount: 1 } },
      { name: 'delete-older', action: { type: 'Delete' }, condition: { tagState: 'any' } },
    ]);
  });
});
```

- [x] **Step 2: Run the tests and make sure that they fail**

Run: `pnpm vitest run packages/api`
Expected: FAIL (modules and files are missing). The Firestore contract test does not run.

- [x] **Step 3: Write the store, the admin script and the server**

`packages/api/src/firestore-store.ts`:

```ts
import type { Firestore } from '@google-cloud/firestore';
import type { KeyRecord } from './keys.ts';
import { decide, usageDocIds, type KeyStore, type Reservation, type ScanLimits, type UsageStore } from './store.ts';

/** Keys in `keys/{sha256}`; usage counters in `usage/{keyHash}_{window}` and `usage/month_{yyyy-mm}`. */
export class FirestoreStore implements KeyStore, UsageStore {
  constructor(private readonly db: Firestore) {}

  private get keys() {
    return this.db.collection('keys');
  }

  async get(hash: string): Promise<KeyRecord | null> {
    const snap = await this.keys.doc(hash).get();
    return snap.exists ? (snap.data() as KeyRecord) : null;
  }

  async put(hash: string, record: KeyRecord): Promise<void> {
    await this.keys.doc(hash).set(record);
  }

  async list(): Promise<(KeyRecord & { hash: string })[]> {
    const snap = await this.keys.orderBy('createdAt').get();
    return snap.docs.map((d) => ({ hash: d.id, ...(d.data() as KeyRecord) }));
  }

  async revoke(prefix: string, at: Date): Promise<number> {
    const snap = await this.keys.where('prefix', '==', prefix).get();
    const live = snap.docs.filter((d) => !d.get('revokedAt'));
    await Promise.all(live.map((d) => d.ref.update({ revokedAt: at.toISOString() })));
    return live.length;
  }

  /** One transaction: three reads, then three writes only if every limit allows. */
  async reserveScan(keyHash: string, now: Date, limits: ScanLimits): Promise<Reservation> {
    const ids = usageDocIds(keyHash, now);
    const usage = this.db.collection('usage');
    const refs = [usage.doc(ids.hour), usage.doc(ids.day), usage.doc(ids.month)] as const;
    return this.db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...refs);
      const [hour, day, month] = snaps.map((s) => (s.get('count') as number | undefined) ?? 0) as [number, number, number];
      const decision = decide({ hour, day, month }, limits, now);
      if (decision.ok) {
        tx.set(refs[0], { count: hour + 1 });
        tx.set(refs[1], { count: day + 1 });
        tx.set(refs[2], { count: month + 1 });
      }
      return decision;
    });
  }
}
```

`packages/api/src/admin.ts`:

```ts
import { parseArgs } from 'node:util';
import { issueKey } from './keys.ts';
import type { KeyStore } from './store.ts';

const USAGE = `Usage:
  admin issue --label <who it is for> [--expires YYYY-MM-DD]
  admin list
  admin revoke <key prefix, e.g. ll_AbC12>
`;

/** Issues, lists and revokes licence keys. Returns an exit code. */
export async function admin(argv: string[], store: KeyStore, out: (s: string) => void, now = new Date()): Promise<number> {
  const usage = (problem?: string) => {
    out(`${problem ? `${problem}\n\n` : ''}${USAGE}`);
    return 2;
  };
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { label: { type: 'string' }, expires: { type: 'string' } } });
  } catch (e) {
    return usage((e as Error).message);
  }
  const [command, arg] = parsed.positionals;
  const { label, expires } = parsed.values;

  if (command === 'issue') {
    if (!label) return usage('issue needs --label.');
    if (expires !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return usage('--expires must be YYYY-MM-DD.');
    const expiresAt = expires ? new Date(`${expires}T00:00:00Z`).toISOString() : null;
    const { key, hash, record } = issueKey(label, expiresAt, now);
    await store.put(hash, record);
    out(`Key for ${label}. It is shown only now; send it to them and do not keep a copy:\n\n  ${key}\n\nPrefix ${record.prefix}, expires ${expires ? `${expires} 00:00 UTC` : 'never'}.\n`);
    return 0;
  }
  if (command === 'list') {
    const keys = await store.list();
    if (keys.length === 0) out('No keys.\n');
    for (const k of keys) {
      const status = k.revokedAt ? 'revoked' : k.expiresAt && Date.parse(k.expiresAt) <= now.getTime() ? 'expired' : 'active';
      out(`${k.prefix}  ${k.label}  created ${k.createdAt.slice(0, 10)}  expires ${k.expiresAt?.slice(0, 10) ?? 'never'}  ${status}\n`);
    }
    return 0;
  }
  if (command === 'revoke') {
    if (!arg) return usage('revoke needs a key prefix.');
    const n = await store.revoke(arg, now);
    out(`Revoked ${n} key${n === 1 ? '' : 's'} with prefix ${arg}.\n`);
    return n > 0 ? 0 : 1;
  }
  return usage(command ? `Unknown command: ${command}` : undefined);
}
```

`packages/api/src/admin-main.ts`:

```ts
import { Firestore } from '@google-cloud/firestore';
import { admin } from './admin.ts';
import { FirestoreStore } from './firestore-store.ts';

// Runs on the owner's laptop after `gcloud auth application-default login`,
// with GOOGLE_CLOUD_PROJECT set. See DEPLOY.md.
const store = new FirestoreStore(new Firestore());
process.exitCode = await admin(process.argv.slice(2), store, (s) => process.stdout.write(s));
```

`packages/api/src/server.ts`:

```ts
import { Firestore } from '@google-cloud/firestore';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { readConfig } from './config.ts';
import { publicWebOnly, systemResolve } from './egress/target.ts';
import { FirestoreStore } from './firestore-store.ts';
import { createScanner } from './scan.ts';
import pkg from '../package.json' with { type: 'json' };

const config = readConfig(process.env);
const store = new FirestoreStore(new Firestore());
const scanner = await createScanner({
  policy: publicWebOnly,
  resolve: systemResolve,
  toolVersion: pkg.version,
  pageTimeoutMs: config.pageTimeoutMs,
  budgetMs: config.budgetMs,
});
const app = createApp({ keys: store, usage: store, scanner, policy: publicWebOnly, resolve: systemResolve, config });
const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8080) });

process.on('SIGTERM', () => {
  server.close();
  void scanner.close();
});
```

- [x] **Step 4: Write the container and deploy files**

`packages/api/Dockerfile`:

```dockerfile
# Build: bundle the API together with the workspace's core code.
FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter "@legal-lint/api..."
RUN pnpm --filter @legal-lint/api build

# Run: Node, the two packages left out of the bundle, and only Chromium's headless shell (smaller image).
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install --omit=dev --no-save --no-package-lock playwright@1.63.0 @google-cloud/firestore@9.3.1 \
  && npx playwright install --with-deps --only-shell chromium \
  && rm -rf /root/.npm /var/lib/apt/lists/*
COPY --from=build /src/packages/api/dist ./dist
COPY packages/api/package.json ./package.json
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

`.dockerignore` and `.gcloudignore` at the repo root (the same content):

```
.git
**/node_modules
**/dist
fixtures
tests
docs
.legal-lint
*.md
!packages/api/DEPLOY.md
```

`packages/api/cloudbuild.yaml`:

```yaml
# Builds the API image from the repo root. deploy.sh passes _IMAGE.
steps:
  - name: gcr.io/cloud-builders/docker
    args: ['build', '-f', 'packages/api/Dockerfile', '-t', '${_IMAGE}', '.']
images: ['${_IMAGE}']
```

`packages/api/cleanup-policy.json`:

```json
[
  { "name": "keep-latest", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 1 } },
  { "name": "delete-older", "action": { "type": "Delete" }, "condition": { "tagState": "any" } }
]
```

`packages/api/deploy.sh` (then run `chmod +x packages/api/deploy.sh`):

```bash
#!/usr/bin/env bash
# Builds the API image with Cloud Build and deploys it to Cloud Run.
# Run from the repo root after the one-time setup in packages/api/DEPLOY.md.
set -euo pipefail

PROJECT="${PROJECT:?Set PROJECT to your Google Cloud project id}"
REGION=us-central1
SERVICE=legal-lint-api
REPO=legal-lint
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/api:$(git rev-parse --short HEAD)"

gcloud builds submit --project "$PROJECT" --config packages/api/cloudbuild.yaml --substitutions "_IMAGE=$IMAGE" .

# Free-tier guard rails: one instance at most, scale to zero, CPU only while handling a request.
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --image "$IMAGE" \
  --service-account "legal-lint-api@$PROJECT.iam.gserviceaccount.com" \
  --execution-environment gen2 \
  --max-instances 1 \
  --min-instances 0 \
  --cpu 1 \
  --memory 2Gi \
  --concurrency 10 \
  --timeout 120 \
  --cpu-throttling \
  --allow-unauthenticated
```

`packages/api/DEPLOY.md` has these sections. Each section has the exact commands:

1. **First: a $1 budget alert.** Console → Billing → Budgets & alerts → Create budget. Set the amount to $1 and the alert thresholds to 50%, 90% and 100%. The alert only sends email. The real limits are a maximum of 1 instance and `SCANS_PER_MONTH`.
2. **Setup (one time):**
   - Install gcloud.
   - `gcloud auth login`, then `gcloud projects create <id>`, and connect the billing account.
   - `gcloud config set project <id>`.
   - `gcloud services enable run.googleapis.com firestore.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com`.
   - `gcloud firestore databases create --location=us-central1` (the default database. The free quota applies only to it.)
   - `gcloud artifacts repositories create legal-lint --repository-format=docker --location=us-central1`.
   - `gcloud artifacts repositories set-cleanup-policies legal-lint --location=us-central1 --policy=packages/api/cleanup-policy.json --no-dry-run`.
   - `gcloud iam service-accounts create legal-lint-api`.
   - `gcloud projects add-iam-policy-binding <id> --member=serviceAccount:legal-lint-api@<id>.iam.gserviceaccount.com --role=roles/datastore.user`.
3. **Deploy:** `PROJECT=<id> ./packages/api/deploy.sh`. Write down the URL of the service. Then run `curl <url>/healthz`.
4. **Issue your first key:**
   - `gcloud auth application-default login`.
   - `pnpm --filter @legal-lint/api build`.
   - `GOOGLE_CLOUD_PROJECT=<id> node packages/api/dist/admin.js issue --label you@example.com`.
   - Also `list` and `revoke <prefix>`.
5. **Connect the CLI to the API:** `LEGAL_LINT_API_URL=<url> legal-lint activate <key>`. Then send the URL to the developer. The developer makes it the default in `packages/cli/src/licence/api.ts`.
6. **Find the layout of the client IP header (one time):**
   - `gcloud run services update legal-lint-api --region us-central1 --update-env-vars LOG_FORWARDED_FOR=1`.
   - Call `/v1/licence` from your laptop.
   - Compare the `forwardedFor` value in the log with `curl -s https://ifconfig.me`.
   - Set `TRUSTED_PROXY_HOPS` so that the selected entry is your address.
   - Remove `LOG_FORWARDED_FOR` again, because it logs IP addresses.
7. **Examine the items that can still cost money:**
   - Image size: `gcloud artifacts docker images list us-central1-docker.pkg.dev/<id>/legal-lint --include-tags`. Free up to 0.5 GB. After that, approximately $0.10/GB each month.
   - Compare the Cloud Build minutes and the outbound traffic with their free allowances on the billing page.
   - Usage in this month: the `usage/month_<yyyy-mm>` document in the Firestore console.
8. **Change the limits:** `gcloud run services update … --update-env-vars SCANS_PER_MONTH=…`. List each variable from `config.ts` with its default.
9. **Test the Firestore store:**
   - `npx firebase-tools emulators:start --only firestore` (needs Java).
   - Then `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm vitest run packages/api/src/firestore-store.test.ts`.

Add this to the scripts of the root `package.json`: `"build:api": "pnpm --filter @legal-lint/api build"`.

- [x] **Step 5: Run the tests and the bundle**

Run: `pnpm vitest run packages/api && pnpm typecheck && pnpm build:api && ls -la packages/api/dist`
Expected: the tests PASS (the Firestore contract does not run). `dist/server.js` and `dist/admin.js` exist. Make sure that the bundle does not contain the TypeScript compiler: `! grep -q "createSourceFile" packages/api/dist/server.js`.

- [x] **Step 6: Try the Firestore emulator if it can run on this machine**

Run `java -version && npx -y firebase-tools@latest emulators:start --only firestore --project legal-lint-test` in the background. Then run `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm vitest run packages/api/src/firestore-store.test.ts`. Then stop the emulator.
Expected: PASS. If the emulator cannot start (the download is blocked, or there is no Java), record that the Firestore contract did not run. Do not mark it as tested.

- [x] **Step 7: Commit**

```bash
git add packages/api .dockerignore .gcloudignore package.json pnpm-lock.yaml
git commit -m "feat(api): add the Firestore store, server entry, key admin script and Cloud Run deploy files"
```

---

### Task 8: CLI licence module and test setup with a licence

**Files:**
- Create: `packages/cli/src/licence/store.ts`, `packages/cli/src/licence/api.ts`, `packages/cli/src/licence/gate.ts`
- Create: `tests/setup/licence.ts`, `tests/helpers/licence.ts`
- Modify: `vitest.config.ts` (`setupFiles`)
- Test: `tests/licence.test.ts`

**Interfaces:**
- Consumes: `licenceResponseSchema`, `scanResponseSchema`, `apiErrorSchema` from `@legal-lint/core`.
- Produces:
  - `interface RuntimeEnv { env: NodeJS.ProcessEnv; fetch: typeof fetch; now: () => Date }`, `defaultRuntime(): RuntimeEnv`
  - `homeDir(env)`, `findKey(env): Promise<{ key: string; source: 'env' | 'file' } | null>`, `saveKey(env, key): Promise<string>`, `maskKey(key)`, `keyHash(key)`, `readCache(env, key)`, `writeCache(env, cache)`, `clearCache(env)`, `interface LicenceCache { keyHash: string; checkedAt: string; expiresAt: string | null }`
  - `DEFAULT_API_URL`, `apiUrl(env): string | null`, `validateKey(rt, base, key, version): Promise<ValidateResult>`, `remoteCapture(rt, base, key, url, version): Promise<SiteCapture>`, `class RemoteScanError extends Error { reason: string }`
  - `CACHE_MS`, `GRACE_MS`, `class LicenceError extends Error`, `interface Licence { key: string; source: 'env' | 'file'; checkedAt: string; expiresAt: string | null; warning?: string }`, `checkLicence(rt, version): Promise<Licence>`, `activate(rt, key, version): Promise<{ file: string; expiresAt: string | null }>`
  - Test helpers: `TEST_KEY`, `makeHome(opts?: { key?: string; checkedAt?: Date | null; expiresAt?: string | null; cacheKey?: string }): Promise<string>`, `fakeFetch(handler: (url: string, body: unknown) => Response | Promise<Response>): typeof fetch & { calls: { url: string; body: unknown }[] }`

- [x] **Step 1: Write the helpers and the test that fails**

`tests/helpers/licence.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Matches the server's key format: ll_ + 32 base62 characters. */
export const TEST_KEY = 'll_0123456789abcdefghijklmnopqrstuv';

/** A temporary LEGAL_LINT_HOME with an optional key file and licence cache. */
export async function makeHome(opts: { key?: string | null; checkedAt?: Date | null; expiresAt?: string | null; cacheKey?: string } = {}): Promise<string> {
  const home = await mkdtemp(path.join(tmpdir(), 'legal-lint-home-'));
  const key = opts.key === undefined ? TEST_KEY : opts.key;
  if (key) await writeFile(path.join(home, 'key'), `${key}\n`);
  if (opts.checkedAt !== null) {
    const hashOf = createHash('sha256').update(opts.cacheKey ?? key ?? TEST_KEY).digest('hex');
    const cache = { keyHash: hashOf, checkedAt: (opts.checkedAt ?? new Date()).toISOString(), expiresAt: opts.expiresAt ?? null };
    await writeFile(path.join(home, 'licence.json'), JSON.stringify(cache));
  }
  return home;
}

export function fakeFetch(handler: (url: string, body: unknown) => Response | Promise<Response>) {
  const calls: { url: string; body: unknown }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    return handler(url, body);
  }) as typeof fetch & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
```

`tests/setup/licence.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Every test runs licensed by default: a key and a fresh cache in a temporary
// home, so the gate passes without any network call. Tests of the gate build
// their own home. The API URL points at a port nothing listens on, so a test
// that does reach for the network fails instead of calling a real server.
const KEY = 'll_0123456789abcdefghijklmnopqrstuv';
const home = mkdtempSync(path.join(tmpdir(), 'legal-lint-home-'));
writeFileSync(path.join(home, 'key'), `${KEY}\n`);
writeFileSync(
  path.join(home, 'licence.json'),
  JSON.stringify({ keyHash: createHash('sha256').update(KEY).digest('hex'), checkedAt: new Date().toISOString(), expiresAt: null }),
);
process.env.LEGAL_LINT_HOME = home;
process.env.LEGAL_LINT_API_URL = 'http://127.0.0.1:9';
delete process.env.LEGAL_LINT_KEY;
```

In `vitest.config.ts`, add `setupFiles: ['tests/setup/licence.ts'],` in `test`.

`tests/licence.test.ts`:

```ts
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
```

- [x] **Step 2: Run the test and make sure that it fails**

Run: `pnpm vitest run tests/licence.test.ts`
Expected: FAIL. The licence modules are missing.

- [x] **Step 3: Write the code**

`packages/cli/src/licence/store.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Everything the licence code touches from the outside world, so tests can replace it. */
export interface RuntimeEnv {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  now: () => Date;
}

export function defaultRuntime(): RuntimeEnv {
  // fetch is looked up per call, so tests that spy on globalThis.fetch see every request.
  return { env: process.env, fetch: (...args) => globalThis.fetch(...args), now: () => new Date() };
}

export type KeySource = 'env' | 'file';

export function homeDir(env: NodeJS.ProcessEnv): string {
  return env.LEGAL_LINT_HOME || path.join(os.homedir(), '.legal-lint');
}

export async function findKey(env: NodeJS.ProcessEnv): Promise<{ key: string; source: KeySource } | null> {
  const fromEnv = env.LEGAL_LINT_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: 'env' };
  try {
    const fromFile = (await readFile(path.join(homeDir(env), 'key'), 'utf8')).trim();
    return fromFile ? { key: fromFile, source: 'file' } : null;
  } catch {
    return null;
  }
}

export async function saveKey(env: NodeJS.ProcessEnv, key: string): Promise<string> {
  const dir = homeDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'key');
  await rm(file, { force: true });
  await writeFile(file, `${key}\n`, { mode: 0o600 });
  return file;
}

export function maskKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 8)}…` : '…';
}

export function keyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export interface LicenceCache {
  keyHash: string;
  checkedAt: string;
  expiresAt: string | null;
}

const cacheFile = (env: NodeJS.ProcessEnv) => path.join(homeDir(env), 'licence.json');

/** The cache for this key, or null when there is none, it is for another key, or it is unreadable. */
export async function readCache(env: NodeJS.ProcessEnv, key: string): Promise<LicenceCache | null> {
  try {
    const cache = JSON.parse(await readFile(cacheFile(env), 'utf8')) as LicenceCache;
    if (cache.keyHash !== keyHash(key) || Number.isNaN(Date.parse(cache.checkedAt))) return null;
    return cache;
  } catch {
    return null;
  }
}

export async function writeCache(env: NodeJS.ProcessEnv, cache: LicenceCache): Promise<void> {
  await mkdir(homeDir(env), { recursive: true, mode: 0o700 });
  await writeFile(cacheFile(env), `${JSON.stringify(cache)}\n`, { mode: 0o600 });
}

export async function clearCache(env: NodeJS.ProcessEnv): Promise<void> {
  await rm(cacheFile(env), { force: true });
}
```

`packages/cli/src/licence/api.ts`:

```ts
import { apiErrorSchema, licenceResponseSchema, scanResponseSchema, type SiteCapture } from '@legal-lint/core';
import type { RuntimeEnv } from './store.ts';

/** Set after the first Cloud Run deploy (packages/api/DEPLOY.md, step 5). Until then LEGAL_LINT_API_URL is required. */
export const DEFAULT_API_URL = '';

export function apiUrl(env: NodeJS.ProcessEnv): string | null {
  const url = (env.LEGAL_LINT_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
  return url || null;
}

export type ValidateResult =
  | { kind: 'valid'; expiresAt: string | null }
  | { kind: 'invalid'; reason: 'unknown' | 'revoked' | 'expired' }
  | { kind: 'unreachable'; detail: string };

/** Sends the key and the package version, nothing else. */
export async function validateKey(rt: RuntimeEnv, base: string, key: string, version: string): Promise<ValidateResult> {
  let res: Response;
  try {
    res = await rt.fetch(`${base}/v1/licence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, version }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return { kind: 'unreachable', detail: (e as Error).message };
  }
  // Rate limits and server errors say nothing about the key, so grace applies.
  if (res.status >= 500 || res.status === 429) return { kind: 'unreachable', detail: `HTTP ${res.status}` };
  const parsed = licenceResponseSchema.safeParse(await res.json().catch(() => null));
  if (!res.ok || !parsed.success) return { kind: 'unreachable', detail: `unexpected answer (HTTP ${res.status})` };
  return parsed.data.valid ? { kind: 'valid', expiresAt: parsed.data.expiresAt } : { kind: 'invalid', reason: parsed.data.reason };
}

export class RemoteScanError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
  }
}

/** Sends the key (as a bearer token), the URL and the package version; returns what the hosted browser recorded. */
export async function remoteCapture(rt: RuntimeEnv, base: string, key: string, url: string, version: string): Promise<SiteCapture> {
  let res: Response;
  try {
    res = await rt.fetch(`${base}/v1/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ url, version }),
      signal: AbortSignal.timeout(150_000),
    });
  } catch (e) {
    throw new RemoteScanError(`Could not reach the Legal Lint scanner (${(e as Error).message}). Scan on this machine with --local.`, 'unreachable');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(body);
    throw new RemoteScanError(err.success ? err.data.error.message : `The scanner answered HTTP ${res.status}.`, err.success ? err.data.error.reason : 'http');
  }
  const parsed = scanResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new RemoteScanError('The scanner sent a result this version of legal-lint cannot read. Update legal-lint, or scan on this machine with --local.', 'bad_response');
  }
  return parsed.data.capture;
}
```

`packages/cli/src/licence/gate.ts`:

```ts
import { apiUrl, validateKey, type ValidateResult } from './api.ts';
import { clearCache, findKey, keyHash, maskKey, readCache, saveKey, writeCache, type KeySource, type LicenceCache, type RuntimeEnv } from './store.ts';

export const CACHE_MS = 24 * 3_600_000;
export const GRACE_MS = 7 * 24 * 3_600_000;

export class LicenceError extends Error {}

export interface Licence {
  key: string;
  source: KeySource;
  checkedAt: string;
  expiresAt: string | null;
  /** Set when running on the grace period. */
  warning?: string;
}

const HOW = 'Set LEGAL_LINT_KEY, or run `legal-lint activate <key>`.';
const REASON = { unknown: 'not recognised', revoked: 'revoked', expired: 'expired' } as const;
const SOURCE = { env: 'LEGAL_LINT_KEY', file: 'the saved key' } as const;

function expired(cache: LicenceCache, now: number): boolean {
  return cache.expiresAt !== null && Date.parse(cache.expiresAt) <= now;
}

async function ask(rt: RuntimeEnv, key: string, version: string): Promise<ValidateResult> {
  const base = apiUrl(rt.env);
  if (!base) return { kind: 'unreachable', detail: 'no licence server is configured; set LEGAL_LINT_API_URL' };
  return validateKey(rt, base, key, version);
}

/** Throws LicenceError when Legal Lint may not run. Calls the API at most once a day. */
export async function checkLicence(rt: RuntimeEnv, version: string): Promise<Licence> {
  const found = await findKey(rt.env);
  if (!found) throw new LicenceError(`Legal Lint needs a licence key. ${HOW}`);
  const now = rt.now().getTime();
  const cached = await readCache(rt.env, found.key);
  const cache = cached && !expired(cached, now) ? cached : null;
  if (cache && now - Date.parse(cache.checkedAt) < CACHE_MS) return { ...found, checkedAt: cache.checkedAt, expiresAt: cache.expiresAt };

  const result = await ask(rt, found.key, version);
  if (result.kind === 'valid') {
    const fresh = { keyHash: keyHash(found.key), checkedAt: rt.now().toISOString(), expiresAt: result.expiresAt };
    await writeCache(rt.env, fresh);
    return { ...found, checkedAt: fresh.checkedAt, expiresAt: fresh.expiresAt };
  }
  if (result.kind === 'invalid') {
    await clearCache(rt.env);
    throw new LicenceError(`The licence key ${maskKey(found.key)} (from ${SOURCE[found.source]}) is ${REASON[result.reason]}. ${HOW}`);
  }
  if (cache && now - Date.parse(cache.checkedAt) < GRACE_MS) {
    const until = new Date(Date.parse(cache.checkedAt) + GRACE_MS).toISOString();
    return {
      ...found,
      checkedAt: cache.checkedAt,
      expiresAt: cache.expiresAt,
      warning: `Could not reach the licence server (${result.detail}). Using the last successful check from ${cache.checkedAt}; this works offline until ${until}.`,
    };
  }
  throw new LicenceError(`Could not check the licence key: ${result.detail}. Connect to the internet and try again.`);
}

/** Checks a key with the API, then saves it and caches the answer. */
export async function activate(rt: RuntimeEnv, rawKey: string, version: string): Promise<{ file: string; expiresAt: string | null }> {
  const key = rawKey.trim();
  const result = await ask(rt, key, version);
  if (result.kind === 'unreachable') throw new LicenceError(`Could not check the key: ${result.detail}. Nothing was saved.`);
  if (result.kind === 'invalid') throw new LicenceError(`The licence key ${maskKey(key)} is ${REASON[result.reason]}. Nothing was saved.`);
  const file = await saveKey(rt.env, key);
  await writeCache(rt.env, { keyHash: keyHash(key), checkedAt: rt.now().toISOString(), expiresAt: result.expiresAt });
  return { file, expiresAt: result.expiresAt };
}
```

- [x] **Step 4: Run the new tests and the full suite**

Run: `pnpm vitest run tests/licence.test.ts && pnpm test && pnpm typecheck`
Expected: PASS. No command has a gate at this time. Thus the setup file does not change the tests that exist.

- [x] **Step 5: Commit**

```bash
git add packages/cli/src/licence tests/licence.test.ts tests/helpers/licence.ts tests/setup/licence.ts vitest.config.ts
git commit -m "feat(cli): add licence key lookup, a 24-hour cache with 7-day offline grace, and the API client"
```

---

### Task 9: Add the gate to the CLI, add activate and licence, and select local or remote URL scans

**Files:**
- Create: `packages/cli/src/scan-url.ts`
- Modify: `packages/cli/src/program.ts`
- Test: `tests/licence-cli.test.ts`, `tests/scan-url.test.ts`

**Interfaces:**
- Consumes: Task 8 (`checkLicence`, `activate`, `defaultRuntime`, `apiUrl`, `remoteCapture`); `isLocalTarget`, `evaluateCapture`, `scanSite` from `@legal-lint/core`.
- Produces:
  - `run(argv: string[], io?: Io, rt?: RuntimeEnv): Promise<number>`
  - `scansLocally(url: string, forceLocal?: boolean): boolean`
  - `interface UrlScanOptions { rt: RuntimeEnv; licence: Licence; version: string; local?: boolean; only?: readonly string[]; timeoutMs?: number; intake?: Intake | null; judgments?: StoredJudgments; capture?: Omit<CaptureOptions, 'toolVersion'> }`
  - `scanUrl(url: string, opts: UrlScanOptions): Promise<ScanReport>`

- [x] **Step 1: Write the tests that fail**

`tests/licence-cli.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT, run } from '../packages/cli/src/program.ts';
import type { RuntimeEnv } from '../packages/cli/src/licence/store.ts';
import { FIXTURES_DIR } from './helpers/fixtures.ts';
import { fakeFetch, json, makeHome, TEST_KEY } from './helpers/licence.ts';

async function cli(rt: RuntimeEnv, ...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, { stdout: { write: (s: string) => (stdout += s), isTTY: false }, stderr: { write: (s: string) => (stderr += s) } }, rt);
  return { code, stdout, stderr };
}

const fixture = path.join(FIXTURES_DIR, 'LL-01', 'fires-vite-css-import');
const keyless = async (): Promise<RuntimeEnv> => ({
  env: { LEGAL_LINT_HOME: await makeHome({ key: null, checkedAt: null }), LEGAL_LINT_API_URL: 'https://api.test' },
  fetch: fakeFetch(() => json(500, {})),
  now: () => new Date(),
});

describe('CLI without a key', () => {
  it('scan and scan-url exit 2 with directions and print no findings', async () => {
    const rt = await keyless();
    for (const argv of [['scan', fixture], ['scan-url', 'https://example.com/']]) {
      const { code, stdout, stderr } = await cli(rt, ...argv);
      expect(code, argv[0]).toBe(EXIT.error);
      expect(stdout).toBe('');
      expect(stderr).toMatch(/needs a licence key.*LEGAL_LINT_KEY.*legal-lint activate/);
    }
  });

  it('help, version and init still work', async () => {
    const rt = await keyless();
    expect((await cli(rt, '--version')).code).toBe(EXIT.clean);
    expect((await cli(rt, '--help')).code).toBe(EXIT.clean);
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-init-'));
    expect((await cli(rt, 'init', dir, '--answers', '{"euUkVisitors":true}')).code).toBe(EXIT.clean);
  });
});

describe('activate and licence', () => {
  it('activate saves a valid key, and licence reports it masked', async () => {
    const home = await makeHome({ key: null, checkedAt: null });
    const rt: RuntimeEnv = { env: { LEGAL_LINT_HOME: home, LEGAL_LINT_API_URL: 'https://api.test' }, fetch: fakeFetch(() => json(200, { valid: true, expiresAt: null })), now: () => new Date() };
    const act = await cli(rt, 'activate', TEST_KEY);
    expect(act.code).toBe(EXIT.clean);
    expect(act.stdout).toContain(path.join(home, 'key'));
    expect(act.stdout).not.toContain(TEST_KEY);
    const status = await cli(rt, 'licence');
    expect(status.code).toBe(EXIT.clean);
    expect(status.stdout).toMatch(/ll_01234….*saved key/s);
    expect(status.stdout).not.toContain(TEST_KEY);
    expect((await cli(rt, 'scan', fixture)).code).toBe(EXIT.findings);
  });

  it('licence exits 2 and explains when there is no key', async () => {
    const { code, stdout } = await cli(await keyless(), 'licence');
    expect(code).toBe(EXIT.error);
    expect(stdout).toMatch(/needs a licence key/);
  });

  it('prints the grace warning on stderr and still scans', async () => {
    const rt: RuntimeEnv = {
      env: { LEGAL_LINT_HOME: await makeHome({ checkedAt: new Date(Date.now() - 2 * 86_400_000) }), LEGAL_LINT_API_URL: 'https://api.test' },
      fetch: fakeFetch(() => Promise.reject(new Error('offline'))),
      now: () => new Date(),
    };
    const { code, stderr } = await cli(rt, 'scan', fixture, '--json');
    expect(code).toBe(EXIT.findings);
    expect(stderr).toMatch(/Could not reach the licence server/);
  });

  it('refuses a licenceKey in the project config with directions', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'legal-lint-cfg-'));
    await writeFile(path.join(dir, 'legal-lint.config.json'), JSON.stringify({ licenceKey: TEST_KEY }));
    const { code, stderr } = await cli({ env: process.env, fetch: fakeFetch(() => json(500, {})), now: () => new Date() }, 'scan', dir);
    expect(code).toBe(EXIT.error);
    expect(stderr).toMatch(/Remove licenceKey/);
  });
});
```

`tests/scan-url.test.ts`:

```ts
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
```

- [x] **Step 2: Run the tests and make sure that they fail**

Run: `pnpm vitest run tests/licence-cli.test.ts tests/scan-url.test.ts`
Expected: FAIL (`scan-url.ts` is missing; `run` ignores `rt`; there are no `activate`/`licence` commands).

- [x] **Step 3: Write `scan-url.ts`**

`packages/cli/src/scan-url.ts`:

```ts
import { evaluateCapture, isLocalTarget, scanSite, type CaptureOptions, type Intake, type ScanReport, type StoredJudgments } from '@legal-lint/core';
import { rules } from '@legal-lint/rules';
import { apiUrl, remoteCapture } from './licence/api.ts';
import type { Licence } from './licence/gate.ts';
import type { RuntimeEnv } from './licence/store.ts';

export interface UrlScanOptions {
  rt: RuntimeEnv;
  licence: Licence;
  version: string;
  /** Use Chromium on this machine even for a public URL. */
  local?: boolean;
  only?: readonly string[];
  /** Page load timeout for local scans; the hosted scanner sets its own. */
  timeoutMs?: number;
  /** undefined: read legal-lint.config.json from the working directory, as before. */
  intake?: Intake | null;
  judgments?: StoredJudgments;
  capture?: Omit<CaptureOptions, 'toolVersion'>;
}

/** localhost and private addresses can only be reached from the user's machine. */
export function scansLocally(url: string, forceLocal?: boolean): boolean {
  return Boolean(forceLocal) || isLocalTarget(new URL(url).hostname);
}

/** Local scans use Chromium here; public URLs go to the hosted scanner. Rules always run here. */
export async function scanUrl(url: string, opts: UrlScanOptions): Promise<ScanReport> {
  const engine = { rules, toolVersion: opts.version, only: opts.only, intake: opts.intake, judgments: opts.judgments };
  if (scansLocally(url, opts.local)) {
    return scanSite(url, { ...engine, capture: { ...opts.capture, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) } });
  }
  const base = apiUrl(opts.rt.env);
  if (!base) throw new Error('No hosted scanner is configured (LEGAL_LINT_API_URL), so only local scans work. Add --local to scan with Chromium on this machine.');
  const capture = await remoteCapture(opts.rt, base, opts.licence.key, url, opts.version);
  const start = capture.pages[0];
  if (!start || start.error) throw new Error(`Could not load ${url}: ${start?.error ?? 'no response'}`);
  return evaluateCapture(capture, engine);
}
```

- [x] **Step 4: Connect `program.ts`**

Changes to `packages/cli/src/program.ts`:

1. Imports:

```ts
import { activate, checkLicence, type Licence } from './licence/gate.ts';
import { defaultRuntime, homeDir, maskKey, type RuntimeEnv } from './licence/store.ts';
import { scanUrl } from './scan-url.ts';
```

2. `buildProgram(io, setExit, rt: RuntimeEnv)`. Add this near the top:

```ts
  // No free tier: scans run only with a valid key. A grace-period warning goes to stderr so --json stays parseable.
  const gate = async (): Promise<Licence> => {
    const licence = await checkLicence(rt, VERSION);
    if (licence.warning) io.stderr.write(`legal-lint: ${licence.warning}\n`);
    return licence;
  };
```

3. `scan` action: the first line is `await gate();`.

4. `scan-url`:
   - Add `.option('--local', 'load the page with Chromium on this machine instead of the hosted scanner (localhost and private addresses always are)')`.
   - Change the `--timeout` description to `'page load timeout in milliseconds (local scans)'`.
   - The action body after the URL validation:

```ts
      const licence = await gate();
      const report = await scanUrl(parsed.href, {
        rt,
        licence,
        version: VERSION,
        local: opts.local,
        only: knownRuleIds(opts.rule),
        timeoutMs: opts.timeout,
      });
      setExit(await output(report, opts, process.cwd(), io));
```

   and give `opts` the type `OutputOptions & { rule?: string[]; timeout: number; local?: boolean }`.

5. New commands, before `mcp`:

```ts
  program
    .command('activate')
    .description('Check a licence key and save it for this user (~/.legal-lint/key). Sends only the key and the version.')
    .argument('<key>', 'licence key, starting ll_')
    .action(async (key: string) => {
      const { file, expiresAt } = await activate(rt, key, VERSION);
      io.stdout.write(`Licence key ${maskKey(key.trim())} is valid${expiresAt ? ` until ${expiresAt.slice(0, 10)}` : ''}. Saved to ${file}.\n`);
    });

  program
    .command('licence')
    .description('Show which licence key is in use and when it was last checked.')
    .action(async () => {
      try {
        const l = await checkLicence(rt, VERSION);
        const from = l.source === 'env' ? 'LEGAL_LINT_KEY' : `the saved key (${homeDir(rt.env)})`;
        io.stdout.write(
          `Key ${maskKey(l.key)} from ${from}.\nLast checked ${l.checkedAt}. Valid until ${l.expiresAt ?? 'no end date'}.\n${l.warning ? `${l.warning}\n` : ''}`,
        );
      } catch (e) {
        io.stdout.write(`${(e as Error).message}\n`);
        setExit(EXIT.error);
      }
    });
```

6. `run(argv, io = process, rt: RuntimeEnv = defaultRuntime())` gives `rt` to `buildProgram`.

`LicenceError` and `RemoteScanError` go to the catch that exists in `run()`. It shows `legal-lint: <message>` and returns `EXIT.error`. No special case is necessary.

- [x] **Step 5: Run the tests**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. The old CLI and HTML report tests pass, because the setup file gives them a licence.

- [x] **Step 6: Commit**

```bash
git add packages/cli/src tests/licence-cli.test.ts tests/scan-url.test.ts
git commit -m "feat(cli): require a licence key for scans, add activate and licence, and send public URL scans to the hosted scanner"
```

---

### Task 10: Add the gate to the MCP server

**Files:**
- Modify: `packages/cli/src/mcp/server.ts`
- Test: `tests/mcp-licence.test.ts`

**Interfaces:**
- Consumes: `checkLicence`, `defaultRuntime`, `scanUrl`.
- Produces: `ServerOptions.runtime?: RuntimeEnv`; the `scan_url` input gets `local?: boolean`.

- [x] **Step 1: Write the test that fails**

`tests/mcp-licence.test.ts`:

```ts
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
```

- [x] **Step 2: Run the test and make sure that it fails**

Run: `pnpm vitest run tests/mcp-licence.test.ts`
Expected: FAIL. The tools run without a key.

- [x] **Step 3: Write the code**

In `packages/cli/src/mcp/server.ts`:

1. Imports:

```ts
import { checkLicence, type Licence } from '../licence/gate.ts';
import { defaultRuntime, type RuntimeEnv } from '../licence/store.ts';
import { scanUrl } from '../scan-url.ts';
```

   Remove `scanSite` from the core import.

2. `ServerOptions`: add `/** Licence lookup and network access; tests pass their own. */ runtime?: RuntimeEnv;`.

3. In `createServer`, after `const server = …`:

```ts
  const rt = opts.runtime ?? defaultRuntime();
  // No free tier: every tool checks the licence first (cached, so this is a file read, not a network call).
  const requireLicence = async (): Promise<Licence> => {
    const licence = await checkLicence(rt, opts.version);
    if (licence.warning) process.stderr.write(`legal-lint mcp: ${licence.warning}\n`);
    return licence;
  };
```

4. Make `await requireLicence();` the first statement of each tool handler. In `scan_url`, write `const licence = await requireLicence();`. Replace the `scanSite(...)` call with:

```ts
      const report = await scanUrl(parsed.href, {
        rt,
        licence,
        version: opts.version,
        local,
        only,
        timeoutMs,
        intake: config?.intake ?? null,
        judgments: config?.judgments ?? {},
        capture: opts.capture,
      });
```

5. `scan_url` input schema: add

```ts
        local: z.boolean().optional().describe('Load the page with Chromium on this machine instead of the hosted scanner. localhost and private addresses always load locally.'),
```

   and destructure `local` in the handler.

6. Replace the first sentence of the `scan_url` description with:

```
'Loads a live or preview URL in headless Chromium and reports what happens before any click: requests to Google Fonts, session replay recording, subscription prices without renewal terms. Public URLs are loaded by the Legal Lint hosted scanner (only the URL is sent); localhost and private addresses load on this machine and need Playwright. '
```

   Keep the remaining text of the description.

7. Add one line to `INSTRUCTIONS`: `- Every tool needs a licence key. If a tool says one is missing, tell the user to set LEGAL_LINT_KEY or run \`legal-lint activate <key>\`.`

- [x] **Step 4: Run the tests**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. This includes the `tests/mcp.test.ts` that exists (the setup file gives it a licence. Its scan_url tests use 127.0.0.1, thus they stay local) and `tests/mcp-stdio.test.ts` (the child process gets `LEGAL_LINT_HOME`).

- [x] **Step 5: Commit**

```bash
git add packages/cli/src/mcp/server.ts tests/mcp-licence.test.ts
git commit -m "feat(mcp): require a licence key for every tool and send public URL scans to the hosted scanner"
```

---

### Task 11: End-to-end remote scan and privacy tests

**Files:**
- Create: `tests/remote-scan.test.ts`
- Modify: `tests/privacy.test.ts`

**Interfaces:**
- Consumes: `createApp`, `createScanner`, `MemoryStore`, `issueKey`, `readConfig` (API); `scanUrl`, `checkLicence`, `run` (CLI); `serve` from `@hono/node-server`.

- [x] **Step 1: Write the end-to-end test**

`tests/remote-scan.test.ts`:

```ts
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
```

If the first run shows that Chromium does not record a request that did not resolve, stop and report. In that condition, the remote scan would not find third-party requests. Do not make the comparison less strict.

- [x] **Step 2: Add the privacy tests**

In `tests/privacy.test.ts`:

1. Change the comment `// Phase 1 has no licence call yet, …` to `// The core scanner never calls home; the licence check lives in the CLI and MCP layers (tested below).`
2. Add imports:

```ts
import { run } from '../packages/cli/src/program.ts';
import { makeHome, TEST_KEY } from './helpers/licence.ts';
```

3. Add in `describe('privacy', …)`:

```ts
  async function cliScan(root: string, home: string) {
    const env = { ...process.env, LEGAL_LINT_HOME: home, LEGAL_LINT_API_URL: 'https://api.legal-lint.test' };
    // fetch is looked up per call, so the spy above sees the licence request.
    return run(['scan', root, '--json'], { stdout: { write: () => true }, stderr: { write: () => true } }, { env, fetch: (...a) => globalThis.fetch(...a), now: () => new Date() });
  }

  it('a CLI scan with a fresh licence cache makes no outbound call', async () => {
    const root = path.join(FIXTURES_DIR, 'LL-01', 'fires-next-pages-document');
    expect(await cliScan(root, await makeHome())).toBe(1);
    expect(outbound).toEqual([]);
  });

  it('a CLI scan with a stale cache sends exactly one licence check, carrying only the key and version', async () => {
    const root = path.join(FIXTURES_DIR, 'LL-01', 'fires-next-pages-document');
    // Two days old: the check is attempted, blocked by this test, and the grace period lets the scan run.
    const home = await makeHome({ checkedAt: new Date(Date.now() - 2 * 86_400_000) });
    expect(await cliScan(root, home)).toBe(1);
    expect(outbound.map((o) => o.channel)).toEqual(['fetch']);
    const [url, init] = JSON.parse(outbound[0]!.payload) as [string, { body: string }];
    expect(url).toBe('https://api.legal-lint.test/v1/licence');
    expect(JSON.parse(init.body)).toEqual({ key: TEST_KEY, version: expect.any(String) });
    expect(findLeaks(outbound, secretsOf(root))).toEqual([]);
  });
```

If the recorded fetch payload has no `body` (for example, because `AbortSignal` does not serialise), parse `outbound[0].payload` one time to see its shape. Then change only the extraction line. The assertion on the body must stay exact.

- [x] **Step 3: Run the tests**

Run: `pnpm vitest run tests/remote-scan.test.ts tests/privacy.test.ts && pnpm test`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add tests/remote-scan.test.ts tests/privacy.test.ts
git commit -m "test: prove remote URL scans match local ones and the licence check sends only the key and version"
```

---

### Task 12: Documentation and final verification

**Files:**
- Modify: `README.md`, `DECISIONS.md`, `LEGAL_REVIEW.md`

- [x] **Step 1: README**

- Status line: `Status: phase 1, milestone 5. Rules LL-01 to LL-05, the CLI, the HTML report, the MCP server, licence keys and the hosted scanner are implemented. Batch URL scans (milestone 3) were skipped for now.`
- A new section **Licence key** after Usage:
  - `legal-lint activate <key>` keeps the key in `~/.legal-lint/key`. `LEGAL_LINT_KEY` overrides it. This is good for CI.
  - `legal-lint licence` shows the key in use and the time of the last check.
  - Without a key, `scan`, `scan-url` and the MCP tools stop and tell the user what to do. `init`, `--help` and `--version` operate.
  - The tool checks the key a maximum of one time each day. If it cannot connect to the server, Legal Lint continues to operate for 7 days after the last good check.
  - Never put the key in `legal-lint.config.json`, because that file is committed.
- Usage: add `activate` and `licence` to the command block, and `--local` to the `scan-url` notes. The Playwright line becomes "Only needed for `--local` and for localhost or private addresses."
- Replace **What leaves your machine** with:
  - `scan` reads your repository locally. The only network call is the licence check. It occurs a maximum of one time each day, and sends your licence key and the Legal Lint version. A test stops each outbound call during a scan. The test fails if the scan sends other data.
  - `scan-url` on a public URL sends the URL (with your key and the version) to the Legal Lint scanner. The scanner loads the page in its own browser and sends back the data that it recorded. Your intake answers and judgments stay on your machine. The rules run on your machine. The scanner logs the first 8 characters of the key, the host of the site, the outcome and the duration. It does not log the full URL.
  - `scan-url` on localhost or a private address, or with `--local`, runs Chromium on your machine and sends nothing to us.
  - The MCP server runs on your machine and uses the same paths.
  - HTML reports stay in your project folder.
- Development: add `pnpm build:api`. Add a line that refers to `packages/api/DEPLOY.md` for the hosted service.

- [x] **Step 2: DECISIONS.md**

Add a `## Licence and hosted API` section with one line for each item:

- **The server records and the client makes the decisions.** The API returns a raw capture. The CLI runs the rules with the local intake and judgments. Thus only the URL goes out of the machine.
- **Public URLs go to the hosted scanner. Localhost and private addresses always run locally. `--local` makes all scans run locally.** The hosted scanner refuses private addresses by design.
- **The key is in `LEGAL_LINT_KEY` or `~/.legal-lint/key`. It is never in `legal-lint.config.json`**, because that file is committed. If a config still has `licenceKey`, the tool refuses it and tells the user what to do.
- **A 24-hour cache. A 7-day grace period only when the tool cannot connect to the API (network, timeout, 5xx, 429).** A clear "invalid" answer stops the tool immediately and clears the cache.
- **The MCP server starts and lists its tools without a key. Each call returns the licence message.** Thus the agent can tell the user what to do. The agent does not see a server that does not operate.
- **Google Cloud Run in us-central1 with request-based billing, a maximum of 1 instance, 1 vCPU, 2 GiB, and the default database of Firestore.** We did not select Fly.io (no free tier) or Render (512 MB, a disk that does not keep data), because we want to stay in the free quota. The owner adds a card and a $1 budget alert.
- **A hard limit of 1,500 scans each month for the full service, and a budget of 40 s to start pages (15 s for each page).** In the worst case, that is half of the free compute quota. The budget alert only sends email.
- **The limits for each IP address are in memory.** This is correct with one instance. The client IP is the entry at position `TRUSTED_PROXY_HOPS` from the right of X-Forwarded-For. You must confirm this after the first deploy.
- **Keys are `ll_` and 32 base62 characters. Firestore keeps only the SHA-256 and the first 8 characters.** Thus, if a person gets a copy of the database, they do not get keys that operate.
- **A scan counts against the limits when Chromium is about to start, also when the load fails.** The compute is used in the two cases. A refused URL does not count.
- **SSRF has three layers:** an input check; an egress proxy in the process that resolves names itself and connects to the checked address (this prevents DNS rebinding); and Chromium flags with the `<-loopback>` proxy setting that Playwright always adds. Only public unicast addresses on ports 80 and 443 are permitted.
- **The image is Node slim and the headless shell of Chromium.** The objective is to stay in the free storage of 0.5 GB of Artifact Registry. A cleanup policy keeps one image. A test fails if the deploy script makes the limits larger, or if the package versions of the image are different from package.json.
- **The API bundle imports core through subpaths (`@legal-lint/core/crawler`, `/remote`, `/address`).** Thus the bundle does not include the TypeScript compiler.
- **By default, the tests run with a licence.** A setup file writes a new cache to a temporary home. It also sets the API URL to a port where no server runs. The gate tests make their own homes.
- **The Firestore store uses the same contract tests as the memory store. These tests run only with the emulator.** Record here if they ran in milestone 5.
- **`DEFAULT_API_URL` is empty until the first deploy.** Until then, activation and remote scans need `LEGAL_LINT_API_URL`.

Also replace the M4 line "No licence check in this milestone. Keyed and keyless MCP tests wait for milestone 5…" with: "**Licence check added in milestone 5;** keyed and keyless MCP tests live in `tests/mcp-licence.test.ts`." Also replace "Blocking private addresses belongs to the hosted API (milestone 5)." with "The hosted API blocks private addresses; local scans do not need to."

- [x] **Step 3: LEGAL_REVIEW.md**

Add a `## Hosted service (milestone 5)` section:

- **Scans of sites that other persons own.** The hosted scanner loads each public URL that a key holder gives it. This can be a site that the key holder does not own. Does the service need terms of use? For example, terms that permit scans only of sites that the user owns or has permission to test, or a robots.txt rule. (We did not do milestone 3, which had the robots.txt support.)
- **Privacy text.** The section "What leaves your machine" in the README now describes the licence check and the hosted scans. Please confirm that it is correct and sufficient as a privacy notice. Also tell us if the service needs a separate privacy policy.
- **Logs.** The service logs the key prefix, the host of the site, the outcome and the duration. During setup, it can log X-Forwarded-For (IP addresses) for a short time. Is a retention period or a notice necessary?
- **Messages that we wrote:** "Legal Lint needs a licence key…", "The hosted scanner has used its scans for this month…", and "… is not a public web address on port 80 or 443, so the hosted scanner will not load it." These messages contain no legal claims. We list them only so that the list is complete.

- [x] **Step 4: Final verification**

Run each command and read the output:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm build:api
git status --short
```

Expected: all tests pass (the Firestore contract does not run if the emulator did not run). The typecheck has no errors. The two bundles build. Only the intended files changed (`.DS_Store` stays uncommitted). Run the full suite a second time. Write the name of each test that is not stable (the known one is LL-03 `fires-runtime-hotjar-websocket`).

- [x] **Step 5: Commit**

```bash
git add README.md DECISIONS.md LEGAL_REVIEW.md
git commit -m "docs: record milestone 5 decisions, licence usage, what the hosted scanner receives, and legal review items"
```

- [ ] **Step 6: Stop and report to the owner**

In simple Hinglish:
- **What operates.**
- **What was tested,** with the test counts.
- **What did not run:** the Firestore emulator (if it did not run), and no real deploy.
- **The next work for the owner:** follow DEPLOY.md. Then send the Cloud Run URL, so that it can become `DEFAULT_API_URL`.
- **Open questions,** with numbered yes/no decisions, if there are some.

Do not start other work.
