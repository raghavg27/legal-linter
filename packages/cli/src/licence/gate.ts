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
  /** Set when the tool runs in the grace period. */
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

/** Throws LicenceError when Legal Lint must not run. Calls the API a maximum of one time each day. */
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

/** Checks a key with the API. Then keeps the key and puts the answer in the cache. */
export async function activate(rt: RuntimeEnv, rawKey: string, version: string): Promise<{ file: string; expiresAt: string | null }> {
  const key = rawKey.trim();
  const result = await ask(rt, key, version);
  if (result.kind === 'unreachable') throw new LicenceError(`Could not check the key: ${result.detail}. Nothing was saved.`);
  if (result.kind === 'invalid') throw new LicenceError(`The licence key ${maskKey(key)} is ${REASON[result.reason]}. Nothing was saved.`);
  const file = await saveKey(rt.env, key);
  await writeCache(rt.env, { keyHash: keyHash(key), checkedAt: rt.now().toISOString(), expiresAt: result.expiresAt });
  return { file, expiresAt: result.expiresAt };
}
