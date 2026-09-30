/**
 * Load test for the rate limiter: schedules N emails "now" for a throwaway user and runs them through
 * separate worker processes using the dryrun transport (nothing is sent), then checks:
 *   - no email is sent twice, none fail
 *   - per sender and UTC hour, reserved send slots never exceed the hourly limit
 *   - per sender, reserved slots are at least the minimum delay apart, and no email is sent before its slot
 * Uses its own queue prefix and user, and removes everything it created when done.
 *
 *   npm run load-test -- --count 1000 --workers 2 --concurrency 5 --gap 100 --limit 200
 */
import { args } from './load-test-env';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../src/config';
import { elastic } from '../src/lib/elastic';
import { prisma } from '../src/lib/prisma';
import { redis } from '../src/lib/redis';
import { createCampaign } from '../src/modules/campaigns/campaign.service';
import { dryrunKeys } from '../src/modules/senders/transport';
import { emailQueue } from '../src/queue/emailQueue';
import { HOUR_MS, turnLogKey } from '../src/queue/rateLimiter';

const { count, workers: workerCount, gapMs, limit, timeoutMs } = args;
const LOAD_TEST_GOOGLE_ID = 'load-test-user';
function startWorkers(): ChildProcess[] {
  const script = path.join(__dirname, 'load-test-worker.ts');
  return Array.from({ length: workerCount }, () =>
    spawn(process.execPath, ['--import', 'tsx', script], { env: process.env, stdio: ['ignore', 'inherit', 'inherit'] }),
  );
}

function percentile(sorted: number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN;
}

async function main() {
  async function cleanup() {
    await emailQueue.obliterate({ force: true }).catch(() => undefined);
    const keys = await redis.keys('loadtest:*');
    if (keys.length) await redis.del(...keys);
    await prisma.user.deleteMany({ where: { googleId: LOAD_TEST_GOOGLE_ID } });
    await elastic.indices.delete({ index: config.esIndex, ignore_unavailable: true }).catch(() => undefined);
  }

  await emailQueue.waitUntilReady();
  await cleanup();
  const senders = await prisma.sender.findMany({ orderBy: { createdAt: 'asc' } });
  if (senders.length === 0) throw new Error('No senders; run npm run seed first');
  const user = await prisma.user.create({
    data: { googleId: LOAD_TEST_GOOGLE_ID, email: 'load-test@example.com', name: 'Load test' },
  });

  console.log(
    `Load test: ${count} emails, ${senders.length} senders, ${workerCount} worker processes x concurrency ${args.concurrency}, ` +
      `min gap ${gapMs} ms, limit ${limit}/sender/hour`,
  );
  const workers = startWorkers();
  try {
    const readyBy = Date.now() + 60_000;
    while ((await emailQueue.getWorkersCount()) < workerCount) {
      if (Date.now() > readyBy) throw new Error('Worker processes did not start');
      await sleep(250);
    }

    const startedAt = Date.now();
    const campaign = await createCampaign(user.id, {
      subject: 'Load test',
      body: 'Load test body',
      leads: Array.from({ length: count }, (_, i) => `lead${i}@example.com`),
      startAt: new Date(startedAt),
      delayBetweenEmailsSec: 0,
      hourlyLimit: 100_000,
    });
    console.log(`Scheduled ${campaign.totalCount} emails in ${Date.now() - startedAt} ms; waiting for sends...`);

    // Done when nothing is due within the next second: the rest are parked in a later hour.
    for (;;) {
      const busy = await prisma.email.count({
        where: {
          campaignId: campaign.id,
          OR: [{ status: 'SENDING' }, { status: { in: ['SCHEDULED', 'DEFERRED'] }, scheduledAt: { lte: new Date(Date.now() + 1000) } }],
        },
      });
      if (busy === 0) break;
      if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out with ${busy} emails still due`);
      await sleep(500);
    }
    const finishedAt = Date.now();

    // ---- Analysis ----
    const emails = await prisma.email.findMany({
      where: { campaignId: campaign.id },
      select: { id: true, toEmail: true, senderId: true, status: true, scheduledAt: true },
    });
    const sendCounts = new Map(Object.entries(await redis.hgetall(dryrunKeys.sendCounts())).map(([k, v]) => [k, Number(v)]));
    const byStatus = emails.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.status]: (acc[e.status] ?? 0) + 1 }), {});
    const duplicates = [...sendCounts.values()].filter((n) => n > 1).length;
    const sentWithoutRecord = emails.filter((e) => e.status === 'SENT' && sendCounts.get(e.id) !== 1).length;
    const sentButPending = emails.filter((e) => e.status !== 'SENT' && sendCounts.has(e.id)).length;

    let maxPerHour = 0;
    let minSlotGap = Infinity;
    let minActualGap = Infinity;
    let minTurnGap = Infinity;
    let sentEarly = 0;
    let inversions = 0;
    const lateness: number[] = [];
    const sendTimes: number[] = [];

    for (const sender of senders) {
      const mine = emails.filter((e) => e.senderId === sender.id);
      const slots = mine.map((e) => ({ idx: Number(e.toEmail.match(/\d+/)![0]), slot: e.scheduledAt.getTime(), id: e.id }));
      slots.sort((a, b) => a.slot - b.slot);

      const perHour = new Map<number, number>();
      for (const s of slots) perHour.set(Math.floor(s.slot / HOUR_MS), (perHour.get(Math.floor(s.slot / HOUR_MS)) ?? 0) + 1);
      maxPerHour = Math.max(maxPerHour, ...perHour.values());
      for (let i = 1; i < slots.length; i++) {
        minSlotGap = Math.min(minSlotGap, slots[i].slot - slots[i - 1].slot);
        if (slots[i].idx < slots[i - 1].idx) inversions++;
      }

      const times = await redis.zrange(dryrunKeys.sendTimes(sender.id), 0, -1, 'WITHSCORES');
      const actual: number[] = [];
      for (let i = 0; i < times.length; i += 2) {
        const email = mine.find((e) => e.id === times[i]);
        const at = Number(times[i + 1]);
        actual.push(at);
        sendTimes.push(at);
        if (email) {
          lateness.push(at - email.scheduledAt.getTime());
          if (at < email.scheduledAt.getTime()) sentEarly++;
        }
      }
      for (let i = 1; i < actual.length; i++) minActualGap = Math.min(minActualGap, actual[i] - actual[i - 1]);

      const turns = (await redis.zrange(turnLogKey(sender.id), 0, -1, 'WITHSCORES')).filter((_, i) => i % 2 === 1).map(Number);
      for (let i = 1; i < turns.length; i++) minTurnGap = Math.min(minTurnGap, turns[i] - turns[i - 1]);
    }
    lateness.sort((a, b) => a - b);
    sendTimes.sort((a, b) => a - b);

    const checks: [string, boolean, string][] = [
      ['No duplicate sends', duplicates === 0, `${duplicates} emails sent more than once`],
      ['No failures', (byStatus.FAILED ?? 0) === 0, `${byStatus.FAILED ?? 0} FAILED`],
      ['Every SENT email sent exactly once', sentWithoutRecord === 0, `${sentWithoutRecord} mismatched`],
      ['No pending email was sent', sentButPending === 0, `${sentButPending} mismatched`],
      ['Hourly limit per sender', maxPerHour <= limit, `max ${maxPerHour} slots in one sender-hour (limit ${limit})`],
      ['Min gap between reserved slots', minSlotGap >= gapMs, `min ${minSlotGap} ms (required ${gapMs})`],
      ['Never sent before its slot', sentEarly === 0, `${sentEarly} early`],
      ['Min gap between granted sends (Redis clock)', minTurnGap >= gapMs, `min ${minTurnGap} ms (required ${gapMs})`],
    ];

    const sendSpan = sendTimes.length > 1 ? sendTimes[sendTimes.length - 1] - sendTimes[0] : 0;
    console.log(`\nStatuses: ${JSON.stringify(byStatus)} (waited ${((finishedAt - startedAt) / 1000).toFixed(1)} s)`);
    console.log(`Sends: ${sendTimes.length} in ${(sendSpan / 1000).toFixed(1)} s`);
    console.log(
      `Send lateness vs slot: p50 ${percentile(lateness, 50)} ms, p99 ${percentile(lateness, 99)} ms, max ${lateness.at(-1)} ms`,
    );
    console.log(
      `Gap as seen by the transport (after the grant; includes process scheduling jitter): min ${minActualGap} ms`,
    );
    console.log(`Order: ${inversions} adjacent out-of-order pairs (by original lead order, per sender)\n`);
    for (const [name, ok, detail] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);

    return checks.every(([, ok]) => ok);
  } finally {
    // Exiting while a child is still being torn down can crash Node on Windows (libuv UV_HANDLE_CLOSING assert).
    await Promise.all(
      workers.map((w) =>
        w.exitCode === null && w.signalCode === null ? new Promise((resolve) => w.once('exit', resolve).kill()) : undefined,
      ),
    );
    await cleanup();
    await emailQueue.close();
    await prisma.$disconnect();
    redis.disconnect();
  }
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
