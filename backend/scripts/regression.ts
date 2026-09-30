/**
 * Regression suite: re-runs the exit checks of every finished stage against real API and worker processes.
 * Fully isolated from the dev stack: own database (scheduler_regression), own Redis prefix, dry-run transport,
 * port 4100. Run after every stage:  npm run test:regression
 */
import { REGRESSION_PORT } from './regression-env';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import jwt from 'jsonwebtoken';
import { config } from '../src/config';
import { prisma } from '../src/lib/prisma';
import { elastic } from '../src/lib/elastic';
import { redis } from '../src/lib/redis';
import { createCampaign } from '../src/modules/campaigns/campaign.service';
import { saveSlackIntegration } from '../src/modules/slack/slack.service';
import { dryrunKeys } from '../src/modules/senders/transport';
import { emailQueue } from '../src/queue/emailQueue';
import { HOUR_MS, turnLogKey } from '../src/queue/rateLimiter';

const BACKEND = path.join(__dirname, '..');
const BASE = `http://localhost:${REGRESSION_PORT}`;
const results: { stage: string; name: string; ok: boolean; detail: string }[] = [];
let stage = '';
let cookie = '';
let userId = '';

function check(name: string, ok: boolean, detail = '') {
  results.push({ stage, name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
}

// ---------- processes ----------

class Proc {
  child?: ChildProcess;
  lines: string[] = [];
  constructor(private entry: string) {}

  start(env: Record<string, string> = {}) {
    this.child = spawn(process.execPath, ['--import', 'tsx', this.entry], {
      cwd: BACKEND,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [this.child.stdout!, this.child.stderr!]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => this.lines.push(...chunk.split('\n').filter(Boolean)));
    }
  }

  count(msg: string) {
    return this.lines.filter((l) => l.includes(`"msg":"${msg}`)).length;
  }

  /** Hard kill (TerminateProcess on Windows): no graceful shutdown, like a crash. */
  async kill() {
    if (!this.child || this.child.exitCode !== null) return;
    const exited = new Promise((resolve) => this.child!.once('exit', resolve));
    this.child.kill('SIGKILL');
    await exited;
  }
}

const api = new Proc('src/server.ts');
const worker = new Proc('src/worker.ts');

async function waitFor<T>(what: string, fn: () => Promise<T | undefined | false>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(250);
  }
}

async function startApi() {
  api.start();
  await waitFor('API health', async () => (await fetch(`${BASE}/api/health`)).ok);
}

async function startWorker(env: Record<string, string> = {}) {
  const before = worker.count('Startup check complete');
  worker.start(env);
  await waitFor('worker startup check', async () => worker.count('Startup check complete') > before);
}

function lastStartupCheck(): { pending: number; requeued: number } {
  const line = worker.lines.filter((l) => l.includes('"msg":"Startup check complete"')).at(-1)!;
  return JSON.parse(line);
}

// ---------- API + data helpers ----------

async function call(method: string, url: string, body?: unknown, auth = true) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    redirect: 'manual',
    headers: { ...(auth && { Cookie: cookie }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, headers: res.headers };
}

async function schedule(leads: string[], startInMs: number, delaySec: number, subject = 'Regression') {
  const res = await call('POST', '/api/campaigns', {
    subject,
    body: 'Regression body',
    leads,
    startAt: new Date(Date.now() + startInMs).toISOString(),
    delayBetweenEmailsSec: delaySec,
    hourlyLimit: 1000,
  });
  if (res.status !== 201) throw new Error(`POST /api/campaigns returned ${res.status}: ${JSON.stringify(res.json)}`);
  return res.json as { id: string; totalCount: number; invalidCount: number; duplicateCount: number };
}

const emailsOf = (campaignId: string) =>
  prisma.email.findMany({ where: { campaignId }, orderBy: { toEmail: 'asc' } });

async function sendCounts(): Promise<Map<string, number>> {
  const raw = await redis.hgetall(dryrunKeys.sendCounts());
  return new Map(Object.entries(raw).map(([k, v]) => [k, Number(v)]));
}

async function waitForStatuses(campaignId: string, done: (e: { status: string }[]) => boolean, timeoutMs = 30_000) {
  return waitFor(`campaign ${campaignId} to settle`, async () => {
    const emails = await emailsOf(campaignId);
    return done(emails) && emails;
  }, timeoutMs);
}

const allSent = (e: { status: string }[]) => e.every((x) => x.status === 'SENT');
const leads = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}@example.com`);

async function deleteKeys(pattern: string) {
  const keys = await redis.keys(pattern);
  if (keys.length) await redis.del(...keys);
}

// ---------- setup ----------

async function setup() {
  console.log('Setup: migrating the regression database...');
  const migrate = spawnSync('npx prisma migrate deploy', { cwd: BACKEND, env: process.env, shell: true, encoding: 'utf8' });
  if (migrate.status !== 0) throw new Error(`prisma migrate deploy failed:\n${migrate.stdout}\n${migrate.stderr}`);

  await prisma.$executeRawUnsafe('TRUNCATE "User", "Sender", "Campaign", "Email", "SlackIntegration" CASCADE');
  await elastic.indices.delete({ index: config.esIndex, ignore_unavailable: true });
  await emailQueue.obliterate({ force: true });
  await deleteKeys(`${config.queuePrefix}:*`);

  for (let i = 1; i <= 3; i++) {
    await prisma.sender.create({
      data: { email: `sender${i}@regression.local`, smtpHost: 'localhost', smtpPort: 587, smtpUser: `s${i}`, smtpPass: 'x' },
    });
  }
  const user = await prisma.user.create({ data: { googleId: 'regression-user', email: 'regression@example.com', name: 'Regression' } });
  userId = user.id;
  cookie = `session=${jwt.sign({ sub: user.id }, config.sessionSecret, { expiresIn: '1h' })}`;

  await startApi();
  await startWorker();
}

// ---------- stages ----------

async function stage1() {
  stage = 'Stage 1 — API skeleton & Google login';
  console.log(`\n${stage}`);
  check('GET /api/health → 200', (await call('GET', '/api/health', undefined, false)).status === 200);
  check('Protected route without session → 401', (await call('GET', '/api/emails?view=scheduled', undefined, false)).status === 401);
  const me = await call('GET', '/api/auth/me');
  check('GET /api/auth/me with session → current user', me.status === 200 && me.json?.email === 'regression@example.com');
  const google = await call('GET', '/api/auth/google', undefined, false);
  check(
    'GET /api/auth/google → redirect to Google (or 503 if not configured)',
    config.google ? google.status === 302 && !!google.headers.get('location')?.startsWith('https://accounts.google.com') : google.status === 503,
    `status ${google.status}`,
  );
}

async function stage2() {
  stage = 'Stage 2 — Scheduling & sending';
  console.log(`\n${stage}`);

  check('Invalid campaign body → 400', (await call('POST', '/api/campaigns', { subject: '' })).status === 400);

  const input = [...leads('s2-', 3), 'not-an-email', 's2-01@example.com'];
  const campaign = await schedule(input, 3000, 1);
  check('Leads cleaned (3 valid, 1 invalid, 1 duplicate)', campaign.totalCount === 3 && campaign.invalidCount === 1 && campaign.duplicateCount === 1);

  const counts = await emailQueue.getJobCounts('delayed');
  check('Jobs are BullMQ delayed jobs', counts.delayed === 3, `delayed=${counts.delayed}`);

  const scheduled = await call('GET', '/api/emails?view=scheduled');
  check('Scheduled view lists them', scheduled.json?.total === 3);
  const planned = new Map<string, number>(scheduled.json.items.map((e: any) => [e.id, new Date(e.scheduledAt).getTime()]));

  const emails = await waitForStatuses(campaign.id, allSent);
  check('All sent', emails.length === 3);
  check('None sent before its scheduled time', emails.every((e) => e.sentAt!.getTime() >= planned.get(e.id)!));
  check('Sent from ≥ 2 different senders', new Set(emails.map((e) => e.senderId)).size >= 2);

  const sent = await call('GET', '/api/emails?view=sent');
  check('Sent view lists them', sent.json?.items?.filter((e: any) => e.subject === 'Regression').length === 3);

  check('Bull Board without session → 401', (await call('GET', '/admin/queues', undefined, false)).status === 401);
  check('Bull Board with session → 200', (await call('GET', '/admin/queues')).status === 200);

  const cronLibs = /["'](node-cron|cron|agenda|node-schedule|bree|croner)["']/;
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.(ts|tsx|json)$/.test(name) && cronLibs.test(readFileSync(file, 'utf8'))) offenders.push(file);
    }
  };
  for (const dir of ['src', '../frontend/src']) walk(path.join(BACKEND, dir));
  for (const pkg of ['package.json', '../frontend/package.json', '../package.json']) {
    if (cronLibs.test(readFileSync(path.join(BACKEND, pkg), 'utf8'))) offenders.push(pkg);
  }
  check('No cron library anywhere', offenders.length === 0, offenders.join(', '));
}

async function stage3() {
  stage = 'Stage 3 — Restart safety & idempotency';
  console.log(`\n${stage}`);

  // A: crash API + worker mid-batch; restart; the rest send exactly once, nothing re-sent.
  const a = await schedule(leads('s3a-', 6), 2000, 1.5);
  const sentBefore = await waitFor('2 sent', async () => {
    const e = await emailsOf(a.id);
    const sent = e.filter((x) => x.status === 'SENT');
    return sent.length >= 2 && sent.map((x) => x.id);
  });
  await Promise.all([api.kill(), worker.kill()]);
  await sleep(4000);
  await startApi();
  await startWorker();
  // A job that was mid-run when killed comes back after BullMQ's 30 s stalled-lock timeout.
  const aEmails = await waitForStatuses(a.id, (e) => e.every((x) => x.status === 'SENT' || x.status === 'FAILED'), 60_000);
  let sends = await sendCounts();
  const interrupted = aEmails.filter((e) => e.status === 'FAILED');
  check(
    'A. Killed mid-batch: every email sent exactly once after restart',
    aEmails.every((e) => (e.status === 'SENT' ? sends.get(e.id) === 1 : !sends.has(e.id))),
    `${aEmails.length - interrupted.length} sent, ${interrupted.length} failed as "interrupted" (at-most-once)`,
  );
  check('A. Emails sent before the crash were not re-sent', sentBefore.every((id) => sends.get(id) === 1));

  // B: an email found in SENDING (a run died mid-send) is failed, never re-sent.
  const b = await schedule(leads('s3b-', 1), 3000, 0);
  await prisma.email.updateMany({ where: { campaignId: b.id }, data: { status: 'SENDING' } });
  const [bEmail] = await waitForStatuses(b.id, (e) => e[0].status === 'FAILED', 15_000);
  sends = await sendCounts();
  check('B. Interrupted send → FAILED "interrupted", 0 sends', bEmail.error?.startsWith('Interrupted') === true && !sends.has(bEmail.id));

  // D: a pending email whose job vanished from Redis is re-queued by the startup check.
  const d = await schedule(leads('s3d-', 1), 5000, 0);
  await worker.kill();
  const [dEmail] = await emailsOf(d.id);
  await emailQueue.remove(dEmail.id);
  await startWorker();
  check('D. Startup check re-queues a missing job', lastStartupCheck().requeued >= 1, `requeued=${lastStartupCheck().requeued}`);
  await waitForStatuses(d.id, allSent, 20_000);
  sends = await sendCounts();
  check('D. Re-queued email sent exactly once', sends.get(dEmail.id) === 1);
  console.log('  (Redis kill/restart is not automated here, because it would hit the dev stack too; see PLAN.md Stage 3, test C)');
}

async function stage4() {
  stage = 'Stage 4 — Concurrency, delay & hourly limits';
  console.log(`\n${stage}`);

  const vitest = spawnSync('npx vitest run', { cwd: BACKEND, env: process.env, shell: true, encoding: 'utf8' });
  const summary = vitest.stdout.match(/Tests\s+(.*)/)?.[1]?.trim() ?? '';
  check('Unit tests (Vitest, incl. Lua against real Redis)', vitest.status === 0, summary);

  // Hourly limit: fresh counters, limit 2 per sender, 12 emails over 3 senders → per sender 2 now, 2 deferred.
  await worker.kill();
  await deleteKeys(`${config.queuePrefix}:rl:*`);
  await startWorker({ MAX_EMAILS_PER_HOUR_PER_SENDER: '2' });
  const c = await schedule(leads('s4-', 12), 0, 0);
  const emails = await waitForStatuses(
    c.id,
    (e) => e.filter((x) => x.status === 'SENT').length === 6 && e.filter((x) => x.status === 'DEFERRED').length === 6,
    30_000,
  ).catch(() => emailsOf(c.id));
  const nowWindow = Math.floor(Date.now() / HOUR_MS);
  const bySender = [...new Set(emails.map((e) => e.senderId))].map((id) => emails.filter((e) => e.senderId === id));
  check(
    'Limit 2/sender/hour: 2 sent + 2 DEFERRED per sender, 0 FAILED',
    bySender.every((g) => g.filter((e) => e.status === 'SENT').length === 2 && g.filter((e) => e.status === 'DEFERRED').length === 2),
    emails.map((e) => e.status[0]).join(''),
  );
  check(
    'Deferred emails moved to a later hour, keeping lead order',
    bySender.every((g) => {
      const sorted = [...g].sort((x, y) => x.scheduledAt.getTime() - y.scheduledAt.getTime());
      const inOrder = sorted.every((e, i) => i === 0 || e.toEmail > sorted[i - 1].toEmail);
      const deferredLater = g.filter((e) => e.status === 'DEFERRED').every((e) => Math.floor(e.scheduledAt.getTime() / HOUR_MS) > nowWindow);
      return inOrder && deferredLater;
    }),
  );
  const sends = await sendCounts();
  const sentIds = emails.filter((e) => e.status === 'SENT').map((e) => e.id);
  const minGapOf = async (key: (senderId: string) => string) => {
    const times = await Promise.all(
      bySender.map(async (g) => (await redis.zrange(key(g[0].senderId), 0, -1, 'WITHSCORES')).filter((_, i) => i % 2 === 1).map(Number)),
    );
    return Math.min(...times.flatMap((t) => t.slice(1).map((v, i) => v - t[i])));
  };
  const turnGap = await minGapOf(turnLogKey);
  check(
    'Min gap between sends from one sender ≥ 1 s (config), whole suite incl. restarts',
    turnGap >= 1000,
    `granted ≥ ${turnGap} ms apart; seen by transport ≥ ${await minGapOf(dryrunKeys.sendTimes)} ms`,
  );
  check('No duplicate sends', sentIds.every((id) => sends.get(id) === 1) && [...sends.values()].every((n) => n === 1));
  await worker.kill();
  await startWorker();

  const load = spawnSync('npm run load-test -- --count 300', { cwd: BACKEND, env: process.env, shell: true, encoding: 'utf8' });
  const failed = load.stdout.split('\n').filter((l) => l.startsWith('FAIL'));
  check('Load test (300 emails, 2 worker processes)', load.status === 0, failed.join('; ') || 'all checks pass');
}

async function stage5() {
  stage = 'Stage 5 — Slack + Elasticsearch';
  console.log(`\n${stage}`);

  // --- Search (real Elasticsearch, separate index) ---
  const search = async (view: string, q: string) =>
    ((await call('GET', `/api/emails?view=${view}&q=${encodeURIComponent(q)}`)).json?.items ?? []) as { toEmail: string; subject: string }[];
  const hits = await waitFor('search index to catch up', async () => {
    const r = await search('sent', 's2-02');
    return r.length > 0 && r;
  }, 15_000).catch(() => []);
  check('Search by part of an address finds the email (Sent tab)', hits.length === 1 && hits[0].toEmail === 's2-02@example.com');
  check('Search by part of a subject finds emails', (await search('sent', 'egress')).length >= 3);
  check('Search respects the tab (a sent email is not in Scheduled results)', (await search('scheduled', 's2-02')).length === 0);
  const other = await prisma.user.create({ data: { googleId: 'regression-other', email: 'other@example.com', name: 'Other' } });
  const theirs = await createCampaign(other.id, {
    subject: 'Private', body: 'x', leads: ['private-lead@example.com'], startAt: new Date(Date.now() + 3_600_000), delayBetweenEmailsSec: 0, hourlyLimit: 10,
  });
  await sleep(2000);
  check("Search never returns another user's emails", (await search('scheduled', 'private-lead')).length === 0);
  await emailQueue.remove((await emailsOf(theirs.id))[0].id);

  // --- Slack routes ---
  const status = await call('GET', '/api/integrations/slack');
  check('Slack status: not connected', status.status === 200 && status.json?.connected === false);
  const connect = await call('GET', '/api/integrations/slack/connect');
  check(
    'Connect Slack → redirect to Slack OAuth (or 503 if not configured)',
    config.slack
      ? connect.status === 302 && !!connect.headers.get('location')?.startsWith('https://slack.com/oauth/v2/authorize') &&
        connect.headers.get('location')!.includes('scope=incoming-webhook')
      : connect.status === 503,
    config.slack ? `status ${connect.status}` : 'SLACK_CLIENT_ID/SECRET not set yet',
  );
  const badCallback = await call('GET', '/api/integrations/slack/callback?code=x&state=forged');
  check('OAuth callback with a forged state is rejected', badCallback.headers.get('location')?.endsWith('slack=invalid_state') === true);
  check('Test message without a connection → 400', (await call('POST', '/api/integrations/slack/test')).status === 400);

  // --- Notifications, against a local fake webhook ---
  const messages: string[] = [];
  let webhookFails = false;
  const hook = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (webhookFails) return void res.writeHead(500).end('boom');
      messages.push(JSON.parse(body).text);
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((resolve) => hook.listen(4201, resolve));
  const webhookUrl = 'http://localhost:4201/hook';

  // Limit 1/sender/hour: every burst of 6 (2 per sender) defers emails on all 3 senders.
  await worker.kill();
  await deleteKeys(`${config.queuePrefix}:rl:*`);
  await startWorker({ MAX_EMAILS_PER_HOUR_PER_SENDER: '1' });
  const burst = async (tag: string) => {
    const c = await schedule(leads(`s5${tag}-`, 6), 0, 0, `Slack ${tag}`);
    await waitForStatuses(c.id, (e) => e.every((x) => x.status === 'SENT' || x.status === 'DEFERRED') && e.some((x) => x.status === 'DEFERRED'), 20_000);
    await sleep(1500); // notifications are fire-and-forget
  };

  try {
    await burst('a');
    check('Limit hit with no Slack connected → no message, no crash', messages.length === 0 && worker.child?.exitCode === null);

    await saveSlackIntegration(userId, { webhookUrl, teamName: 'Regression', channelName: '#alerts' });
    check('Slack status: connected', (await call('GET', '/api/integrations/slack')).json?.connected === true);
    check('Test message reaches the webhook', (await call('POST', '/api/integrations/slack/test')).status === 204 && messages.length === 1);

    messages.length = 0;
    await burst('b');
    await burst('c');
    const senders = new Set(messages.map((m) => m.match(/`([^`]+)`/)?.[1]));
    check(
      'Connected (no restart) → one message per sender per hour, not per email',
      messages.length === 3 && senders.size === 3,
      `${messages.length} messages for 2 bursts × 3 senders`,
    );

    await call('DELETE', '/api/integrations/slack');
    messages.length = 0;
    await burst('d');
    check('Disconnected → no message, no crash', messages.length === 0 && worker.child?.exitCode === null);

    await saveSlackIntegration(userId, { webhookUrl, teamName: 'Regression', channelName: '#alerts' });
    webhookFails = true;
    await burst('e');
    check('Slack error → logged, sending unaffected', worker.count('Slack notification failed') >= 1 && worker.child?.exitCode === null);

    webhookFails = false;
    messages.length = 0;
    await burst('f');
    check('Reconnected (no restart) → messages resume', messages.length === 3, `${messages.length} messages`);
  } finally {
    hook.close();
    await worker.kill();
    await startWorker();
  }
}

/** Field names of an `interface Name { ... }` in the frontend's types/api.ts. */
function frontendFields(source: string, name: string): string[] {
  const match = source.match(new RegExp(`interface ${name}(?:<[^>]*>)?(?: extends (\\w+))? \\{([^}]*)\\}`));
  const own = [...(match?.[2] ?? '').matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
  return [...own, ...(match?.[1] ? frontendFields(source, match[1]) : [])].sort();
}

async function stage6() {
  stage = 'Stage 6 — Frontend foundation';
  console.log(`\n${stage}`);

  const frontend = path.join(BACKEND, '..', 'frontend');
  const build = spawnSync('npm run build', { cwd: frontend, shell: true, encoding: 'utf8' });
  const errors = `${build.stdout}${build.stderr}`.split('\n').filter((l) => /error TS\d+/.test(l));
  check('Frontend type-checks and builds (tsc -b && vite build)', build.status === 0, errors.slice(0, 3).join('; '));

  // The frontend's types must match what the API actually returns, field for field.
  const types = readFileSync(path.join(frontend, 'src', 'types', 'api.ts'), 'utf8');
  const me = await call('GET', '/api/auth/me');
  const emails = await call('GET', '/api/emails?view=sent');
  const slack = await call('GET', '/api/integrations/slack');
  const pairs: [string, unknown][] = [
    ['User', me.json],
    ['Page', emails.json],
    ['EmailItem', emails.json?.items?.[0]],
    ['SlackStatus', slack.json],
  ];
  for (const [name, actual] of pairs) {
    const expected = frontendFields(types, name).join(',');
    const got = actual && typeof actual === 'object' ? Object.keys(actual).sort().join(',') : 'no data';
    check(`Frontend type ${name} matches the API response`, expected === got, expected === got ? '' : `types: ${expected} | API: ${got}`);
  }
}

async function stage7() {
  stage = 'Stage 7 — Frontend features';
  console.log(`\n${stage}`);
  const frontend = path.join(BACKEND, '..', 'frontend');
  const types = readFileSync(path.join(frontend, 'src', 'types', 'api.ts'), 'utf8');
  const sameFields = (name: string, actual: unknown) => {
    const expected = frontendFields(types, name).join(',');
    const got = actual && typeof actual === 'object' ? Object.keys(actual).sort().join(',') : 'no data';
    check(`Frontend type ${name} matches the API response`, expected === got, expected === got ? '' : `types: ${expected} | API: ${got}`);
  };

  // --- Email detail + counts ---
  const sentList = await call('GET', '/api/emails?view=sent');
  const first = sentList.json?.items?.[0] as { id: string } | undefined;
  const detail = await call('GET', `/api/emails/${first?.id}`);
  sameFields('EmailDetail', detail.json);
  const row = first && (await prisma.email.findUnique({ where: { id: first.id }, include: { campaign: true } }));
  check('Email detail returns the full body', detail.status === 200 && !!row && detail.json?.body === row.campaign.body);
  const theirs = await prisma.email.findFirst({ where: { user: { googleId: 'regression-other' } } });
  check("Another user's email → 404", (await call('GET', `/api/emails/${theirs?.id}`)).status === 404);
  check('Malformed email id → 404', (await call('GET', '/api/emails/not-a-uuid')).status === 404);

  const counts = await call('GET', '/api/emails/counts');
  sameFields('EmailCounts', counts.json);
  const scheduledList = await call('GET', '/api/emails?view=scheduled');
  check(
    'Sidebar counts match the list totals',
    counts.json?.scheduled === scheduledList.json?.total && counts.json?.sent === sentList.json?.total,
    `counts ${JSON.stringify(counts.json)}; lists scheduled=${scheduledList.json?.total} sent=${sentList.json?.total}`,
  );

  // --- Search precision (every word must match; "@" searches addresses only) ---
  const tomorrow = new Date(Date.now() + 24 * HOUR_MS).toISOString();
  await call('POST', '/api/campaigns', {
    subject: 'Quarterly pricing update', body: 'x', leads: ['precision-a@example.com', 'pricing-b@example.com'],
    startAt: tomorrow, delayBetweenEmailsSec: 0, hourlyLimit: 100,
  });
  const search = async (q: string) =>
    ((await call('GET', `/api/emails?view=scheduled&q=${encodeURIComponent(q)}`)).json?.items ?? []) as { toEmail: string }[];
  const both = await waitFor('search index to catch up', async () => {
    const r = await search('pricing upd');
    return r.length === 2 && r;
  }, 15_000).catch(() => []);
  check('Search: several words, all must match (prefix)', both.length === 2);
  check('Search: a word that matches nothing excludes the email', (await search('pricing zebra')).length === 0);
  const byAddress = await search('pricing-b@');
  check('Search with "@" matches the address only', byAddress.length === 1 && byAddress[0].toEmail === 'pricing-b@example.com');

  // --- 1,000-lead CSV: the browser's extractor counts it right, and scheduling creates 1,000 rows ---
  const { extractEmails } = (await import(pathToFileURL(path.join(frontend, 'src', 'lib', 'extractEmails.ts')).href)) as {
    extractEmails: (text: string) => string[];
  };
  const csv = [
    'name,email,company',
    ...Array.from({ length: 1000 }, (_, i) => `Lead ${i},"csv-lead-${i}@Example.com",Acme ${i % 7}`),
    ...Array.from({ length: 50 }, (_, i) => `Dup ${i},CSV-LEAD-${i}@example.COM,Acme`),
    'Nobody,no email here,Acme',
    'Broken,bad@,Acme',
    'Broken,@bad.com,Acme',
  ].join('\r\n');
  const leads = extractEmails(csv);
  check('CSV with 1,000 leads (+50 duplicates, 3 junk rows) → 1,000 addresses detected', leads.length === 1000, `${leads.length} detected`);
  const created = await call('POST', '/api/campaigns', {
    subject: 'CSV import', body: 'x', leads, startAt: tomorrow, delayBetweenEmailsSec: 0, hourlyLimit: 1000,
  });
  const rows = created.json?.id ? await prisma.email.count({ where: { campaignId: created.json.id } }) : 0;
  check('Scheduling the uploaded list creates 1,000 emails', created.status === 201 && created.json?.totalCount === 1000 && rows === 1000, `${rows} rows`);

  // --- Search over more than 1,000 matches still finds all of them ---
  await schedule(Array.from({ length: 5 }, (_, i) => `csv-follow-${i}@example.com`), 24 * HOUR_MS, 0, 'CSV import follow-up');
  const total = await waitFor('search index to catch up', async () => {
    const t = (await call('GET', `/api/emails?view=scheduled&q=${encodeURIComponent('CSV import')}`)).json?.total;
    return t === 1005 && t;
  }, 20_000).catch(async () => (await call('GET', `/api/emails?view=scheduled&q=CSV%20import`)).json?.total);
  check('Search matching 1,005 emails finds all of them', total === 1005, `total ${total}`);
}

// ---------- main ----------

async function main() {
  const started = Date.now();
  try {
    await setup();
    await stage1();
    await stage2();
    await stage3();
    await stage4();
    await stage5();
    await stage6();
    await stage7();
  } catch (err) {
    check('Suite ran to completion', false, (err as Error).message);
  } finally {
    await Promise.all([api.kill(), worker.kill()]);
    await emailQueue.obliterate({ force: true }).catch(() => undefined);
    await deleteKeys(`${config.queuePrefix}:*`).catch(() => undefined);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  for (const r of failed) console.log(`  FAILED: [${r.stage}] ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
  return failed.length === 0;
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
