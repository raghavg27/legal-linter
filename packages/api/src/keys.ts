import { createHash, randomInt } from 'node:crypto';
import type { KeyStore } from './store.ts';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** ll_ plus 32 base62 characters, about 190 bits. */
export const KEY_PATTERN = /^ll_[0-9A-Za-z]{32}$/;

export interface KeyRecord {
  /** First 8 characters of the key, for listing and revoking. */
  prefix: string;
  /** Who the key is for. */
  label: string;
  createdAt: string;
  /** The key stops working at this instant. null: never. */
  expiresAt: string | null;
  revokedAt: string | null;
}

export type KeyCheck = { valid: true; hash: string; record: KeyRecord } | { valid: false; reason: 'unknown' | 'revoked' | 'expired' };

export function generateKey(): string {
  let key = 'll_';
  for (let i = 0; i < 32; i++) key += ALPHABET[randomInt(ALPHABET.length)];
  return key;
}

/** The store keeps only this hash, so a leaked database does not leak working keys. */
export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function keyPrefix(key: string): string {
  return key.slice(0, 8);
}

export function issueKey(label: string, expiresAt: string | null, now: Date): { key: string; hash: string; record: KeyRecord } {
  const key = generateKey();
  return {
    key,
    hash: hashKey(key),
    record: { prefix: keyPrefix(key), label, createdAt: now.toISOString(), expiresAt, revokedAt: null },
  };
}

export async function checkKey(store: KeyStore, key: string, now: Date): Promise<KeyCheck> {
  if (!KEY_PATTERN.test(key)) return { valid: false, reason: 'unknown' };
  const hash = hashKey(key);
  const record = await store.get(hash);
  if (!record) return { valid: false, reason: 'unknown' };
  if (record.revokedAt) return { valid: false, reason: 'revoked' };
  if (record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()) return { valid: false, reason: 'expired' };
  return { valid: true, hash, record };
}
