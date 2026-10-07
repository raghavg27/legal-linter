import { apiErrorSchema, licenceResponseSchema, scanResponseSchema, type SiteCapture } from '@legal-lint/core';
import type { RuntimeEnv } from './store.ts';

/** Set after the first Cloud Run deploy (packages/api/DEPLOY.md, step 5). Until then, LEGAL_LINT_API_URL is necessary. */
export const DEFAULT_API_URL = '';

export function apiUrl(env: NodeJS.ProcessEnv): string | null {
  const url = (env.LEGAL_LINT_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
  return url || null;
}

export type ValidateResult =
  | { kind: 'valid'; expiresAt: string | null }
  | { kind: 'invalid'; reason: 'unknown' | 'revoked' | 'expired' }
  | { kind: 'unreachable'; detail: string };

/** Sends the key and the package version, and nothing else. */
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
  // Rate limits and server errors give no information about the key. Thus the grace period applies.
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

/** Sends the key (as a bearer token), the URL and the package version. Returns the data that the hosted browser recorded. */
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
