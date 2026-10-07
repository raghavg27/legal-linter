import { describe, expect, it } from 'vitest';
import { decide, MemoryStore, secondsUntilNext, windowIds } from './store.ts';
import { LIMITS, storeContract } from './store-contract.ts';

storeContract('memory', async () => new MemoryStore());

describe('window helpers', () => {
  it('names UTC windows', () => {
    expect(windowIds(new Date('2026-10-07T05:06:07Z'))).toEqual({ hour: '2026-10-07T05', day: '2026-10-07', month: '2026-10' });
  });

  it('counts seconds to the next window, never zero', () => {
    const t = new Date('2026-12-31T23:59:30Z');
    expect(secondsUntilNext(t, 'hour')).toBe(30);
    expect(secondsUntilNext(t, 'day')).toBe(30);
    expect(secondsUntilNext(t, 'month')).toBe(30);
    expect(secondsUntilNext(new Date('2026-10-07T00:00:00Z'), 'hour')).toBe(3600);
  });

  it('checks the month before the key limits', () => {
    const t = new Date('2026-10-07T00:00:00Z');
    expect(decide({ hour: 9, day: 9, month: 4 }, LIMITS, t)).toMatchObject({ reason: 'monthly_budget' });
    expect(decide({ hour: 9, day: 3, month: 0 }, LIMITS, t)).toMatchObject({ reason: 'key_day' });
    expect(decide({ hour: 2, day: 0, month: 0 }, LIMITS, t)).toMatchObject({ reason: 'key_hour' });
    expect(decide({ hour: 1, day: 2, month: 3 }, LIMITS, t)).toEqual({ ok: true });
  });
});
