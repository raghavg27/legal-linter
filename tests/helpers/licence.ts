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
