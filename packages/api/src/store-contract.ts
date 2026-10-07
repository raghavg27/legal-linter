import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { KeyStore, UsageStore } from './store.ts';

export const LIMITS = { perKeyHour: 2, perKeyDay: 3, perMonth: 4 };

/** The same contract runs against Firestore when the emulator is available (Task 7). */
export function storeContract(name: string, make: () => Promise<KeyStore & UsageStore>) {
  describe(`${name} store`, () => {
    it('stores, lists and revokes keys by prefix', async () => {
      const store = await make();
      const id = randomUUID().slice(0, 5);
      const rec = { prefix: `ll_${id}`, label: 'x', createdAt: '2026-10-07T00:00:00.000Z', expiresAt: null, revokedAt: null };
      await store.put(`hash-${id}`, rec);
      expect(await store.get(`hash-${id}`)).toEqual(rec);
      expect(await store.get(`missing-${id}`)).toBeNull();
      expect((await store.list()).some((r) => r.hash === `hash-${id}`)).toBe(true);
      expect(await store.revoke(`ll_${id}`, new Date('2026-10-08T00:00:00Z'))).toBe(1);
      expect((await store.get(`hash-${id}`))?.revokedAt).toBe('2026-10-08T00:00:00.000Z');
      expect(await store.revoke(`ll_${id}`, new Date())).toBe(0);
    });

    it('counts scans per key hour, key day and service month', async () => {
      const store = await make();
      // A unique year per run keeps the global month counter separate between runs.
      const year = 3000 + Math.floor(Math.random() * 5000);
      const at = (iso: string) => new Date(`${year}-${iso}Z`);
      const a = `key-a-${randomUUID()}`;
      const b = `key-b-${randomUUID()}`;
      expect(await store.reserveScan(a, at('03-10T10:00:00'), LIMITS)).toEqual({ ok: true });
      expect(await store.reserveScan(a, at('03-10T10:30:00'), LIMITS)).toEqual({ ok: true });
      expect(await store.reserveScan(a, at('03-10T10:59:00'), LIMITS)).toEqual({ ok: false, reason: 'key_hour', retryAfterSec: 60 });
      expect(await store.reserveScan(a, at('03-10T11:00:00'), LIMITS)).toEqual({ ok: true });
      expect(await store.reserveScan(a, at('03-10T12:00:00'), LIMITS)).toMatchObject({ ok: false, reason: 'key_day' });
      expect(await store.reserveScan(b, at('03-11T09:00:00'), LIMITS)).toEqual({ ok: true });
      // Month total is now 4 across both keys.
      expect(await store.reserveScan(b, at('03-11T09:10:00'), LIMITS)).toMatchObject({ ok: false, reason: 'monthly_budget' });
      expect(await store.reserveScan(b, at('04-01T00:00:00'), LIMITS)).toEqual({ ok: true });
    });
  });
}
