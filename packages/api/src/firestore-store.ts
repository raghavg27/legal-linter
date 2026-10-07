import type { Firestore } from '@google-cloud/firestore';
import type { KeyRecord } from './keys.ts';
import { decide, usageDocIds, type KeyStore, type Reservation, type ScanLimits, type UsageStore } from './store.ts';

/** Keys in `keys/{sha256}`. Usage counters in `usage/{keyHash}_{window}` and `usage/month_{yyyy-mm}`. */
export class FirestoreStore implements KeyStore, UsageStore {
  constructor(private readonly db: Firestore) {}

  private get keys() {
    return this.db.collection('keys');
  }

  async get(hash: string): Promise<KeyRecord | null> {
    const snap = await this.keys.doc(hash).get();
    return snap.exists ? (snap.data() as KeyRecord) : null;
  }

  async put(hash: string, record: KeyRecord): Promise<void> {
    await this.keys.doc(hash).set(record);
  }

  async list(): Promise<(KeyRecord & { hash: string })[]> {
    const snap = await this.keys.orderBy('createdAt').get();
    return snap.docs.map((d) => ({ hash: d.id, ...(d.data() as KeyRecord) }));
  }

  async revoke(prefix: string, at: Date): Promise<number> {
    const snap = await this.keys.where('prefix', '==', prefix).get();
    const live = snap.docs.filter((d) => !d.get('revokedAt'));
    await Promise.all(live.map((d) => d.ref.update({ revokedAt: at.toISOString() })));
    return live.length;
  }

  /** One transaction: three reads, then three writes only if each limit permits them. */
  async reserveScan(keyHash: string, now: Date, limits: ScanLimits): Promise<Reservation> {
    const ids = usageDocIds(keyHash, now);
    const usage = this.db.collection('usage');
    const refs = [usage.doc(ids.hour), usage.doc(ids.day), usage.doc(ids.month)] as const;
    return this.db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...refs);
      const [hour, day, month] = snaps.map((s) => (s.get('count') as number | undefined) ?? 0) as [number, number, number];
      const decision = decide({ hour, day, month }, limits, now);
      if (decision.ok) {
        tx.set(refs[0], { count: hour + 1 });
        tx.set(refs[1], { count: day + 1 });
        tx.set(refs[2], { count: month + 1 });
      }
      return decision;
    });
  }
}
