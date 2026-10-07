/** In memory. This is correct because the service runs as one instance. */
export class FixedWindowLimiter {
  private readonly hits = new Map<string, { window: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  hit(id: string, now: Date): { ok: true } | { ok: false; retryAfterSec: number } {
    const window = Math.floor(now.getTime() / this.windowMs);
    const current = this.hits.get(id);
    const count = current?.window === window ? current.count + 1 : 1;
    this.hits.set(id, { window, count });
    if (this.hits.size > 10_000) this.prune(window);
    if (count <= this.limit) return { ok: true };
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(((window + 1) * this.windowMs - now.getTime()) / 1000)) };
  }

  /** True when this id has used all of the current window. Does not count a hit. */
  blocked(id: string, now: Date): boolean {
    const current = this.hits.get(id);
    return current?.window === Math.floor(now.getTime() / this.windowMs) && current.count >= this.limit;
  }

  private prune(window: number): void {
    for (const [id, entry] of this.hits) if (entry.window !== window) this.hits.delete(id);
  }
}

export class BusyError extends Error {}

/** A maximum of maxRunning jobs at the same time and maxWaiting in the queue. The queue refuses more jobs immediately. */
export class ScanQueue {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly maxRunning: number,
    private readonly maxWaiting: number,
  ) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.running < this.maxRunning) {
      this.running++;
    } else {
      if (this.waiting.length >= this.maxWaiting) throw new BusyError('All scan slots are busy.');
      // The job that ends gives its position to the next job. Thus `running` does not change.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}

/**
 * The client address from X-Forwarded-For. Proxies add entries at the end.
 * Clients can add entries only at the start. Thus count `trustedHops` entries
 * from the right.
 */
export function clientIp(forwardedFor: string | undefined, trustedHops: number): string {
  const parts = (forwardedFor ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - trustedHops] ?? 'unknown';
}
