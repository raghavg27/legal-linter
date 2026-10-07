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
