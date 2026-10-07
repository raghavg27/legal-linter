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
    ['fd20:abcd::1', false], // unique-local, for internal networks
    ['ff02::1', false],
    ['::ffff:127.0.0.1', false], // IPv4-mapped loopback
    ['::ffff:8.8.8.8', true],
    ['2002:7f00:1::', false], // 6to4 that contains 127.0.0.1
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
  // Hostnames as new URL(...).hostname gives them. Thus unusual IPv4 spellings come in a normal form.
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
