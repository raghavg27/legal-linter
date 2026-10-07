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
