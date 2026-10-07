import { describe, expect, it } from 'vitest';
import { checkKey, generateKey, hashKey, issueKey, KEY_PATTERN, keyPrefix } from './keys.ts';
import { MemoryStore } from './store.ts';

const NOW = new Date('2026-10-07T12:00:00Z');

describe('keys', () => {
  it('generates distinct keys in the documented format', () => {
    const keys = new Set(Array.from({ length: 200 }, generateKey));
    expect(keys.size).toBe(200);
    for (const k of keys) expect(k).toMatch(KEY_PATTERN);
  });

  it('hashes stably and keeps an 8-character prefix', () => {
    const k = 'll_0123456789abcdefghijklmnopqrstuv';
    expect(hashKey(k)).toBe(hashKey(k));
    expect(hashKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(keyPrefix(k)).toBe('ll_01234');
  });

  it('issues a record that does not contain the key', () => {
    const { key, hash, record } = issueKey('founder@example.com', null, NOW);
    expect(hash).toBe(hashKey(key));
    expect(JSON.stringify(record)).not.toContain(key);
    expect(record).toEqual({ prefix: keyPrefix(key), label: 'founder@example.com', createdAt: NOW.toISOString(), expiresAt: null, revokedAt: null });
  });

  it('answers valid, unknown, revoked and expired', async () => {
    const store = new MemoryStore();
    const ok = issueKey('a', null, NOW);
    const old = issueKey('b', '2026-10-07T12:00:00.000Z', NOW);
    const gone = issueKey('c', null, NOW);
    for (const k of [ok, old, gone]) await store.put(k.hash, k.record);
    await store.revoke(gone.record.prefix, NOW);

    expect(await checkKey(store, ok.key, NOW)).toMatchObject({ valid: true, hash: ok.hash });
    expect(await checkKey(store, generateKey(), NOW)).toEqual({ valid: false, reason: 'unknown' });
    expect(await checkKey(store, 'not a key', NOW)).toEqual({ valid: false, reason: 'unknown' });
    expect(await checkKey(store, gone.key, NOW)).toEqual({ valid: false, reason: 'revoked' });
    // Expiry is exclusive: at the stored instant, the key stops.
    expect(await checkKey(store, old.key, NOW)).toEqual({ valid: false, reason: 'expired' });
    expect(await checkKey(store, old.key, new Date(NOW.getTime() - 1))).toMatchObject({ valid: true });
  });
});
