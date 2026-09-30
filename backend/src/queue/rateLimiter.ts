import type IORedis from 'ioredis';
import { config } from '../config';

export const HOUR_MS = 60 * 60 * 1000;

/**
 * Atomically reserves the next send slot for one sender, so it is safe across any number of
 * concurrent jobs, worker processes and machines.
 *
 * KEYS[1]  next-slot key: earliest time this sender may send again
 * ARGV[1]  prefix of the per-hour counter keys (the UTC hour-window number is appended)
 * ARGV[2]  now (ms)   ARGV[3] min gap between sends (ms)   ARGV[4] max sends per hour
 *
 * Returns { slot, deferred }: deferred = 1 when the hourly limit pushed the slot into a later hour.
 * Slots are handed out strictly one after another, so overflow keeps the order jobs asked in.
 */
const RESERVE_SLOT_LUA = `
local HOUR = 3600000
local now = tonumber(ARGV[2])
local gap = tonumber(ARGV[3])
local limit = tonumber(ARGV[4])

local slot = math.max(now, tonumber(redis.call('GET', KEYS[1]) or '0'))
local window = math.floor(slot / HOUR)

while tonumber(redis.call('GET', ARGV[1] .. window) or '0') >= limit do
  window = window + 1
  slot = math.max(slot, window * HOUR)
end

-- Deferred only when the current hour is full; spacing alone crossing into the next hour doesn't count.
local nowWindow = math.floor(now / HOUR)
local deferred = 0
if window > nowWindow and tonumber(redis.call('GET', ARGV[1] .. nowWindow) or '0') >= limit then
  deferred = 1
end

local countKey = ARGV[1] .. window
redis.call('INCR', countKey)
redis.call('PEXPIREAT', countKey, (window + 2) * HOUR)
redis.call('SET', KEYS[1], slot + gap, 'PX', (slot + gap - now) + HOUR)
return { slot, deferred }
`;

/**
 * Send-time guard. Jobs can run late (e.g. behind a burst of new jobs in the wait list), and a late job
 * would land right next to an on-time one. This grants a send only if the sender's last granted send is
 * at least the gap ago, using Redis' clock so all workers and machines agree.
 *
 * KEYS[1] last-send key   KEYS[2] grant log (only written when ARGV[2] is set; used by load tests)
 * ARGV[1] min gap (ms)     ARGV[2] email id to log the grant under, or ''
 * Returns 0 when granted, otherwise how many ms to wait.
 */
const ACQUIRE_TURN_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local gap = tonumber(ARGV[1])
local last = tonumber(redis.call('GET', KEYS[1]) or '0')
if now - last < gap then
  return gap - (now - last)
end
redis.call('SET', KEYS[1], now, 'PX', gap + 60000)
if ARGV[2] ~= '' then
  redis.call('ZADD', KEYS[2], now, ARGV[2])
end
return 0
`;

type RedisWithReserve = IORedis & {
  reserveSendSlot(nextKey: string, countPrefix: string, now: number, gap: number, limit: number): Promise<[number, number]>;
  acquireSendTurn(lastKey: string, logKey: string, gap: number, logAs: string): Promise<number>;
};

export const turnLogKey = (senderId: string) => `${config.queuePrefix}:rl:${senderId}:turns`;

export interface SlotReservation {
  slot: number;
  deferred: boolean;
}

export function createRateLimiter(redis: IORedis) {
  if (!('reserveSendSlot' in redis)) {
    redis.defineCommand('reserveSendSlot', { numberOfKeys: 1, lua: RESERVE_SLOT_LUA });
    redis.defineCommand('acquireSendTurn', { numberOfKeys: 2, lua: ACQUIRE_TURN_LUA });
  }
  const client = redis as RedisWithReserve;

  return {
    async reserveSendSlot(
      senderId: string,
      now = Date.now(),
      { gapMs = config.minDelayBetweenSendsMs, hourlyLimit = config.maxEmailsPerHourPerSender } = {},
    ): Promise<SlotReservation> {
      const base = `${config.queuePrefix}:rl:${senderId}`;
      const [slot, deferred] = await client.reserveSendSlot(`${base}:next`, `${base}:count:`, now, gapMs, hourlyLimit);
      return { slot: Number(slot), deferred: deferred === 1 };
    },

    /**
     * 0 = go ahead and send now; otherwise wait this many ms and ask again.
     * With `logAs`, a granted turn is also recorded (Redis clock) in `turnLogKey(senderId)`.
     */
    async acquireSendTurn(
      senderId: string,
      { gapMs = config.minDelayBetweenSendsMs, logAs = '' }: { gapMs?: number; logAs?: string } = {},
    ): Promise<number> {
      const base = `${config.queuePrefix}:rl:${senderId}`;
      return Number(await client.acquireSendTurn(`${base}:last`, turnLogKey(senderId), gapMs, logAs));
    },
  };
}
