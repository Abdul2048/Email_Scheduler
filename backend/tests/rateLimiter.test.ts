import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { createRateLimiter, HOUR_MS } from '../src/queue/rateLimiter';

// Runs against the real local Redis: the whole point is Redis-side atomicity.
const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
const limiter = createRateLimiter(redis);
const senders: string[] = [];

function newSender(): string {
  const id = `test-${randomUUID()}`;
  senders.push(id);
  return id;
}

// A fixed time a few hours ahead, 1 s into an hour window, so key expiries land in the future.
const hourStart = (Math.floor(Date.now() / HOUR_MS) + 3) * HOUR_MS;
const now = hourStart + 1000;
const windowOf = (ms: number) => Math.floor(ms / HOUR_MS);

beforeAll(async () => {
  await redis.connect();
});

afterAll(async () => {
  for (const id of senders) {
    const keys = await redis.keys(`${config.queuePrefix}:rl:${id}:*`);
    if (keys.length) await redis.del(...keys);
  }
  await redis.quit();
});

describe('reserveSendSlot', () => {
  it('never exceeds the hourly limit under 100 parallel reservations, overflowing into the next hours', async () => {
    const sender = newSender();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => limiter.reserveSendSlot(sender, now, { gapMs: 0, hourlyLimit: 30 })),
    );

    const perWindow = new Map<number, number>();
    for (const r of results) perWindow.set(windowOf(r.slot), (perWindow.get(windowOf(r.slot)) ?? 0) + 1);
    const w = windowOf(now);
    expect([...perWindow.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [w, 30],
      [w + 1, 30],
      [w + 2, 30],
      [w + 3, 10],
    ]);
    expect(results.filter((r) => r.deferred)).toHaveLength(70);
    expect(results.filter((r) => r.deferred).every((r) => windowOf(r.slot) > w)).toBe(true);
    // Deferred emails start at the top of their hour, never earlier.
    expect(Math.min(...results.filter((r) => windowOf(r.slot) === w + 1).map((r) => r.slot))).toBe(hourStart + HOUR_MS);
  });

  it('spaces parallel reservations exactly minDelay apart, with no two slots equal', async () => {
    const sender = newSender();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => limiter.reserveSendSlot(sender, now, { gapMs: 2000, hourlyLimit: 1000 })),
    );
    const slots = results.map((r) => r.slot).sort((a, b) => a - b);
    expect(slots[0]).toBe(now);
    for (let i = 1; i < slots.length; i++) expect(slots[i] - slots[i - 1]).toBe(2000);
    expect(results.some((r) => r.deferred)).toBe(false);
  });

  it('hands out slots in request order and keeps the gap after overflowing to the next hour', async () => {
    const sender = newSender();
    const nearEnd = hourStart + HOUR_MS - 10_000;
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await limiter.reserveSendSlot(sender, nearEnd, { gapMs: 2000, hourlyLimit: 2 }));
    }
    // 2 fit before the hour ends; the rest start at the next hour, still 2 s apart.
    const next = hourStart + HOUR_MS;
    expect(results).toEqual([
      { slot: nearEnd, deferred: false },
      { slot: nearEnd + 2000, deferred: false },
      { slot: next, deferred: true },
      { slot: next + 2000, deferred: true },
    ]);
  });

  it('does not flag a deferral when only the gap pushes a send into the next hour', async () => {
    const sender = newSender();
    const nearEnd = hourStart + HOUR_MS - 1000;
    await limiter.reserveSendSlot(sender, nearEnd, { gapMs: 2000, hourlyLimit: 10 });
    const second = await limiter.reserveSendSlot(sender, nearEnd, { gapMs: 2000, hourlyLimit: 10 });
    expect(second).toEqual({ slot: nearEnd + 2000, deferred: false });
  });

  it('keeps senders independent', async () => {
    const a = newSender();
    const b = newSender();
    await limiter.reserveSendSlot(a, now, { gapMs: 2000, hourlyLimit: 1 });
    const second = await limiter.reserveSendSlot(b, now, { gapMs: 2000, hourlyLimit: 1 });
    expect(second).toEqual({ slot: now, deferred: false });
  });

  it('sends immediately once the last send is older than the gap', async () => {
    const sender = newSender();
    await limiter.reserveSendSlot(sender, now, { gapMs: 2000, hourlyLimit: 10 });
    const later = await limiter.reserveSendSlot(sender, now + 60_000, { gapMs: 2000, hourlyLimit: 10 });
    expect(later).toEqual({ slot: now + 60_000, deferred: false });
  });

  it('acquireSendTurn grants exactly one of many parallel callers per gap', async () => {
    const sender = newSender();
    const waits = await Promise.all(Array.from({ length: 20 }, () => limiter.acquireSendTurn(sender, { gapMs: 2000 })));
    expect(waits.filter((w) => w === 0)).toHaveLength(1);
    expect(waits.filter((w) => w > 0).every((w) => w <= 2000)).toBe(true);
  });

  it('sets expiries so counter keys clean themselves up', async () => {
    const sender = newSender();
    await limiter.reserveSendSlot(sender, now, { gapMs: 2000, hourlyLimit: 10 });
    const base = `${config.queuePrefix}:rl:${sender}`;
    expect(await redis.pexpiretime(`${base}:count:${windowOf(now)}`)).toBe((windowOf(now) + 2) * HOUR_MS);
    expect(await redis.pttl(`${base}:next`)).toBeGreaterThan(0);
  });
});
