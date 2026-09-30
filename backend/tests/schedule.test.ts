import { describe, expect, it } from 'vitest';
import { cleanLeads } from '../src/modules/campaigns/leads';
import { computeSendTimes } from '../src/modules/campaigns/schedule';

const HOUR = 3_600_000;
const start = new Date('2026-01-01T10:00:00Z');
const offsets = (times: Date[]) => times.map((t) => t.getTime() - start.getTime());

describe('computeSendTimes', () => {
  it('spaces emails by the delay', () => {
    expect(offsets(computeSendTimes({ count: 4, startAt: start, delayMs: 2000, hourlyLimit: 100 }))).toEqual([
      0, 2000, 4000, 6000,
    ]);
  });

  it('moves overflow to the next hour block when the hourly limit is reached', () => {
    const times = computeSendTimes({ count: 5, startAt: start, delayMs: 1000, hourlyLimit: 2 });
    expect(offsets(times)).toEqual([0, 1000, HOUR, HOUR + 1000, 2 * HOUR]);
  });

  it('does not over-fill an hour when the delay itself crosses hour blocks', () => {
    const delayMs = 25 * 60_000;
    const times = computeSendTimes({ count: 6, startAt: start, delayMs, hourlyLimit: 2 });
    const perHour = new Map<number, number>();
    for (const t of offsets(times)) perHour.set(Math.floor(t / HOUR), (perHour.get(Math.floor(t / HOUR)) ?? 0) + 1);
    expect(Math.max(...perHour.values())).toBeLessThanOrEqual(2);
    expect(offsets(times)).toEqual([...offsets(times)].sort((a, b) => a - b));
  });

  it('never exceeds the hourly limit for large batches', () => {
    const times = computeSendTimes({ count: 1000, startAt: start, delayMs: 0, hourlyLimit: 200 });
    const perHour = new Map<number, number>();
    for (const t of offsets(times)) perHour.set(Math.floor(t / HOUR), (perHour.get(Math.floor(t / HOUR)) ?? 0) + 1);
    expect([...perHour.values()]).toEqual([200, 200, 200, 200, 200]);
  });
});

describe('cleanLeads', () => {
  it('normalizes, dedupes and counts invalid entries', () => {
    expect(cleanLeads([' A@x.com', 'a@x.com', 'b@y.org', 'nope', '', 'c@z'])).toEqual({
      emails: ['a@x.com', 'b@y.org'],
      invalidCount: 3,
      duplicateCount: 1,
    });
  });
});
