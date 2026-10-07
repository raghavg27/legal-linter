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
