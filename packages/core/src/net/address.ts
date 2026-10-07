import ipaddr from 'ipaddr.js';

function bare(host: string): string {
  return host.replace(/^\[|\]$/g, '');
}

/**
 * True only for a public unicast address. All these are refused: loopback,
 * private, link-local (the location of cloud metadata servers), unique-local,
 * carrier-grade NAT, multicast, reserved ranges, and IPv4 addresses in IPv6.
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
    // ::ffff:10.0.0.1 and similar addresses: examine the IPv4 address in it.
    if (v6.isIPv4MappedAddress()) return isPublicAddress(v6.toIPv4Address().toString());
    // Global unicast is 2000::/3. ipaddr.js calls all addresses that it has no name for "unicast".
    if (!v6.match(ipaddr.IPv6.parse('2000::'), 3)) return false;
  }
  return addr.range() === 'unicast';
}

/** True for hostnames that have a meaning only on the machine or network of the user. */
export function isLocalTarget(hostname: string): boolean {
  const host = bare(hostname).toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  return ipaddr.isValid(host) && !isPublicAddress(host);
}
