import { describe, expect, it } from 'vitest';
import { BusyError, clientIp, FixedWindowLimiter, ScanQueue } from './limits.ts';

describe('FixedWindowLimiter', () => {
  it('allows the limit per window per id, then reports when to retry', () => {
    const l = new FixedWindowLimiter(2, 60_000);
    const t = new Date('2026-10-07T00:00:10Z');
    expect(l.hit('a', t)).toEqual({ ok: true });
    expect(l.hit('a', t)).toEqual({ ok: true });
    expect(l.blocked('a', t)).toBe(true);
    expect(l.hit('a', t)).toEqual({ ok: false, retryAfterSec: 50 });
    expect(l.hit('b', t)).toEqual({ ok: true });
    expect(l.hit('a', new Date('2026-10-07T00:01:00Z'))).toEqual({ ok: true });
  });
});

describe('ScanQueue', () => {
  it('runs up to maxRunning, queues up to maxWaiting, and refuses the rest', async () => {
    const q = new ScanQueue(1, 1);
    let release!: () => void;
    const first = q.run(() => new Promise<string>((r) => (release = () => r('first'))));
    const second = q.run(async () => 'second');
    await expect(q.run(async () => 'third')).rejects.toBeInstanceOf(BusyError);
    release();
    expect(await first).toBe('first');
    expect(await second).toBe('second');
    expect(await q.run(async () => 'fourth')).toBe('fourth');
  });

  it('frees the slot when a job throws', async () => {
    const q = new ScanQueue(1, 0);
    await expect(q.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await q.run(async () => 'ok')).toBe('ok');
  });
});

describe('clientIp', () => {
  it('takes the entry the trusted proxy appended, ignoring what the client prepended', () => {
    expect(clientIp('6.6.6.6, 203.0.113.9', 1)).toBe('203.0.113.9');
    expect(clientIp('6.6.6.6, 203.0.113.9, 10.0.0.1', 2)).toBe('203.0.113.9');
    expect(clientIp(undefined, 1)).toBe('unknown');
    expect(clientIp('', 1)).toBe('unknown');
  });
});
