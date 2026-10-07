import type { KeyRecord } from './keys.ts';

export interface KeyStore {
  get(hash: string): Promise<KeyRecord | null>;
  put(hash: string, record: KeyRecord): Promise<void>;
  list(): Promise<(KeyRecord & { hash: string })[]>;
  /** Revokes every live key with this prefix. Returns how many. */
  revoke(prefix: string, at: Date): Promise<number>;
}

export interface ScanLimits {
  perKeyHour: number;
  perKeyDay: number;
  /** For the whole service, to stay inside the free compute quota. */
  perMonth: number;
}

export type Reservation = { ok: true } | { ok: false; reason: 'key_hour' | 'key_day' | 'monthly_budget'; retryAfterSec: number };

export interface UsageStore {
  /** Counts one scan if every limit allows it, atomically. */
  reserveScan(keyHash: string, now: Date, limits: ScanLimits): Promise<Reservation>;
}

/** Fixed UTC windows: simple to count, and the same in every store. */
export function windowIds(now: Date): { hour: string; day: string; month: string } {
  const iso = now.toISOString();
  return { hour: iso.slice(0, 13), day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

export function secondsUntilNext(now: Date, unit: 'hour' | 'day' | 'month'): number {
  const next = new Date(now);
  if (unit === 'hour') next.setUTCMinutes(60, 0, 0);
  else if (unit === 'day') next.setUTCHours(24, 0, 0, 0);
  else {
    next.setUTCMonth(next.getUTCMonth() + 1, 1);
    next.setUTCHours(0, 0, 0, 0);
  }
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

/** The month is checked first: when the service budget is gone, no key can help. */
export function decide(counts: { hour: number; day: number; month: number }, limits: ScanLimits, now: Date): Reservation {
  if (counts.month >= limits.perMonth) return { ok: false, reason: 'monthly_budget', retryAfterSec: secondsUntilNext(now, 'month') };
  if (counts.day >= limits.perKeyDay) return { ok: false, reason: 'key_day', retryAfterSec: secondsUntilNext(now, 'day') };
  if (counts.hour >= limits.perKeyHour) return { ok: false, reason: 'key_hour', retryAfterSec: secondsUntilNext(now, 'hour') };
  return { ok: true };
}

/** Usage document ids, shared with the Firestore store. */
export function usageDocIds(keyHash: string, now: Date): { hour: string; day: string; month: string } {
  const w = windowIds(now);
  return { hour: `${keyHash}_${w.hour}`, day: `${keyHash}_${w.day}`, month: `month_${w.month}` };
}

/** For tests and local runs. */
export class MemoryStore implements KeyStore, UsageStore {
  private readonly keys = new Map<string, KeyRecord>();
  private readonly counts = new Map<string, number>();

  async get(hash: string): Promise<KeyRecord | null> {
    return this.keys.get(hash) ?? null;
  }

  async put(hash: string, record: KeyRecord): Promise<void> {
    this.keys.set(hash, record);
  }

  async list(): Promise<(KeyRecord & { hash: string })[]> {
    return [...this.keys].map(([hash, record]) => ({ hash, ...record }));
  }

  async revoke(prefix: string, at: Date): Promise<number> {
    let n = 0;
    for (const [hash, record] of this.keys) {
      if (record.prefix !== prefix || record.revokedAt) continue;
      this.keys.set(hash, { ...record, revokedAt: at.toISOString() });
      n++;
    }
    return n;
  }

  async reserveScan(keyHash: string, now: Date, limits: ScanLimits): Promise<Reservation> {
    const ids = usageDocIds(keyHash, now);
    const count = (id: string) => this.counts.get(id) ?? 0;
    const decision = decide({ hour: count(ids.hour), day: count(ids.day), month: count(ids.month) }, limits, now);
    if (decision.ok) for (const id of Object.values(ids)) this.counts.set(id, count(id) + 1);
    return decision;
  }
}
