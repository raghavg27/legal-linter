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
