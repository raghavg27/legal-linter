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
