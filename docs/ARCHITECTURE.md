# Architecture

## 1. Components

```
Browser ──https://localhost:5173──▶ Vite dev server (React app)
                                      │  proxies /api and /admin
                                      ▼
                          API process (Express, :4000) ──────▶ PostgreSQL  (source of truth)
                          - Google + Slack OAuth               Redis (AOF) (queue + rate-limit counters)
                          - campaigns / emails / search        Elasticsearch (search copy)
                          - Bull Board at /admin/queues
                                      │ enqueue
                                      ▼
                          Worker process (BullMQ) ──SMTP──▶ Ethereal
                                                  ──HTTPS─▶ Slack incoming webhook
```

- **One origin for the browser.** Vite serves the app over HTTPS and proxies the API, so cookies just work and Slack gets the HTTPS redirect it requires.
- **API and worker are two entry points in one codebase** (`server.ts`, `worker.ts`), so either can be restarted alone during the demo.
- **One BullMQ queue**, `email-send`, with one job per email. Search indexing and Slack messages are simple best-effort calls made from the API or worker. They don't need their own queues.

## 2. Tech stack

Backend: TypeScript, Express, Prisma + PostgreSQL, BullMQ + ioredis, Nodemailer, `@elastic/elasticsearch`, `@bull-board/express`, `google-auth-library`, zod (config/validation), pino.
Frontend: Vite, React, TypeScript, Tailwind, React Router, TanStack Query, sonner.
Infra: Docker Compose (Postgres, Redis, Elasticsearch).

## 3. Data model

```
User             id | googleId (unique) | email | name | avatarUrl | createdAt
Sender           id | email | smtpHost | smtpPort | smtpUser | smtpPass | createdAt
Campaign         id | userId | subject | body | startAt | delayMs | hourlyLimit | totalCount | createdAt
Email            id | campaignId | userId | senderId | toEmail | subject | status
                 | scheduledAt | sentAt | previewUrl | error | createdAt | updatedAt
                 UNIQUE(campaignId, toEmail)
                 INDEX(userId, status, scheduledAt)   -- scheduled tab
                 INDEX(userId, status, updatedAt)     -- sent tab
SlackIntegration id | userId (unique) | webhookUrl | teamName | channelName | createdAt
```

`EmailStatus`: `SCHEDULED`, `DEFERRED` (moved to a later hour by the rate limiter), `SENDING`, `SENT`, `FAILED`.
Scheduled tab = `SCHEDULED`, `DEFERRED`, `SENDING`. Sent tab = `SENT`, `FAILED`.

## 4. Scheduling (on `POST /api/campaigns`)

1. Clean up the leads (trim, lowercase, valid format, dedupe).
2. Compute send times. This also applies the **hourly limit from the Compose form**:
   ```
   t = startAt; hourStart = startAt; countThisHour = 0
   for each lead i:
       if countThisHour == hourlyLimit:          # campaign's hour is full
           hourStart = hourStart + 1h
           t = max(t, hourStart)
           countThisHour = 0
       scheduledAt[i] = t
       senderId[i]    = senders[i % senders.length]   # round-robin across Ethereal senders
       t += delayBetweenEmails
       countThisHour += 1
   ```
3. One DB transaction inserts the `Campaign` and all `Email` rows (`createMany`).
4. `queue.addBulk()` in chunks of 500: `{ data: { emailId, senderId }, opts: { jobId: emailId, delay: max(0, scheduledAt - now), attempts: 3, backoff: exponential } }`.
5. Best effort: bulk-index the new emails into Elasticsearch.

The job carries only IDs (plus the worker's own progress: reserved slot, SMTP result). The worker always reads the email's current state from Postgres.

## 5. Worker, concurrency & rate limiting

### 5.1 Job processing

```
job { emailId, senderId, slot?, sent? }
0. If job.data.sent is set → SMTP already accepted it on an earlier attempt → just mark SENT, return.
1. If job has no slot: slot = reserveSendSlot(senderId)               (Lua, §5.2)
   This is the job's first Redis call (senderId is in the job data), so jobs running in parallel
   reserve in queue (FIFO) order. The slot is saved in job data, so a re-run never reserves twice.
2. Load the email. If SENT or FAILED → return (already done).
   If SENDING → the previous run crashed mid-send → mark FAILED "interrupted", return.
   If a slot was just reserved: email.scheduledAt = slot, and status DEFERRED if the hourly limit
   pushed it into a later hour (+ Slack notify in Stage 5, §6).
3. If slot is more than 250 ms away: job.moveToDelayed(slot); throw DelayedError
   (not counted as a retry). Otherwise sleep until the slot.
4. Claim: UPDATE email SET status=SENDING WHERE id=? AND status IN (SCHEDULED, DEFERRED)
   0 rows → return.
5. Send-time guard (Lua, §5.2): wait until at least MIN_DELAY has passed since this sender's last send.
6. Send via nodemailer (one pooled transport per sender, warmed up when the worker boots).
   Error   → set status back to SCHEDULED, clear the slot (the retry reserves a new one), rethrow.
             On the last attempt → FAILED with the error.
   Success → first save { sentAt, previewUrl } into job.data (Redis), then mark SENT in Postgres.
             If the DB write fails, the retry hits step 0 and never re-sends.
7. Best effort: update the Elasticsearch doc.
```

**Concurrency:** `new Worker('email-send', fn, { concurrency: WORKER_CONCURRENCY })`. This is safe with any number of parallel jobs or worker processes, because the only shared decisions (claiming an email, reserving a slot, taking a send turn) are atomic in Postgres and Redis. Nothing is counted in memory.

### 5.2 Rate limiting: two small Redis Lua scripts (`queue/rateLimiter.ts`)

Keys are `{QUEUE_PREFIX}:rl:{senderId}:…` (prefix `bull` by default).

**`reserveSendSlot`**: plans when an email may go out.

```
slot   = max(now, GET next)                         -- next = earliest time this sender may send again
window = floor(slot / 3600000)                      -- UTC hour window
while GET count:{window} >= limit:                  -- that hour is full
    window = window + 1
    slot   = max(slot, window * 3600000)            -- start of next hour
deferred = window > nowWindow and GET count:{nowWindow} >= limit
INCR count:{window}; PEXPIREAT count:{window} (window + 2) * 3600000
SET next = slot + minDelay
return { slot, deferred }
```

- **Hourly limit per sender**, in Redis keys `hour_window + sender`, safe across instances.
- **Overflow into the next hour window, in order.** Slots are handed out one after another from `next`, so later requests always get later slots. Nothing is dropped or failed.
- `deferred` is only set when the limit caused the move. The gap alone pushing a send past the top of the hour doesn't count, so Slack only hears about real limit hits.

**`acquireSendTurn`**: enforces the gap at the moment of sending. Slots are planned `minDelay` apart, but a job can still run late, for example behind a burst of new jobs in BullMQ's wait list. That late job would then land right next to an on-time one. So just before SMTP, and after the DB claim so DB latency can't squeeze two sends together, the worker asks this script. It uses Redis' own clock (`TIME`), so every process and machine agrees. It grants the turn only if the sender's last granted send was at least `minDelay` ago; otherwise it returns how long to wait. The wait is at most one gap, so the job waits in-process and asks again, instead of re-queueing and possibly losing the race repeatedly.

Together: **minimum delay** between actual sends per sender (2 s by default) and **hourly limit** per sender, both atomic in Redis across any number of workers.

Trade-offs:
- A late send isn't recovered: the guard pushes the following sends back too, so lateness carries forward until the sender's queue has a gap.
- The `next` pointer is per sender and FIFO. If emails are already parked in a later hour and the limit is *raised*, new emails still queue behind them.
- A reserved slot whose job never sends (e.g. its campaign was deleted) still counts toward that hour. This errs on the safe side.

### 5.3 Behavior with 1000+ emails at the same time

- They're inserted in chunks and queued in chunks of 500 (well under a second).
- When they become due, each job runs once to reserve a slot and goes back to delayed until that slot. Each sender then sends one email every 2 s, and all senders run in parallel (up to `WORKER_CONCURRENCY` × worker processes).
- With 3 senders and a 200/hour limit, about 600 go out in the first hour and the rest move in order into the following hours. Each affected user gets one Slack message per sender per hour.
- `npm run load-test` checks all of this with real worker processes and the dry-run transport (§5.4).

### 5.4 Load test (`npm run load-test -w backend`)

Spawns `--workers` separate worker processes (default 2) on an isolated queue (`QUEUE_PREFIX=loadtest`) with `EMAIL_TRANSPORT=dryrun`. The dry-run transport sends nothing and records every "send" and its time in Redis. The test schedules `--count` emails (default 1000) for "now" as a throwaway user, waits until nothing is due, then checks:
- no duplicate sends and no failures;
- per sender and UTC hour, never more than the limit;
- reserved slots at least the gap apart, and never sent before the slot;
- actual sends at least the gap apart.

It also prints lateness and out-of-order counts, then deletes everything it created. Flags: `--count --workers --concurrency --gap --limit`. The defaults are a 100 ms gap and 200/hour, so a run finishes in about 30 s.

## 6. Slack

- Connect: `/api/integrations/slack/connect` → `[slack.com/oauth/v2/authorize?scope=incoming-webhook&state=](http://slack.com/oauth/v2/authorize?scope=incoming-webhook&state=)…`. The user picks a channel. The callback calls `oauth.v2.access` and saves `incoming_webhook.url`, team, and channel for the user.
- Notify: when an email is deferred to a later hour, the worker reads the user's `SlackIntegration` **from the DB at that moment**. Connecting or disconnecting takes effect immediately, with no restart.
  - No integration → skip.
  - `SET notify:{userId}:{senderId}:{hourWindow} NX EX 7200` → only the first deferral in that hour sends a message.
  - POST to the webhook inside try/catch. A Slack failure is logged and never affects sending.
- Disconnect: delete the row.

## 7. Persistence on restart

| What | Where | Why it survives |
| --- | --- | --- |
| Emails, campaigns, statuses | Postgres | Docker volume |
| Delayed jobs | Redis | AOF on + Docker volume |
| Rate-limit counters / next-slot keys | Redis | Same (with TTLs) |
| Job that was running when a worker died | Redis | BullMQ stalled-job recovery puts it back in the queue once its 30 s lock expires; steps 0–1 of §5.1 then prevent a double send |

Worker boot runs a one-time check: every `SCHEDULED`/`DEFERRED` email with no job in Redis (`getJobState() === 'unknown'`) gets its job re-added (same `jobId`, so this is harmless if it already exists or several workers boot at once). Nothing that is already `SENT` is ever re-queued, so a batch never restarts from the beginning.

Emails that fell due while the worker was down all become due at once on restart. They then reserve slots like any other burst (§5.2), so they're spaced out again and still respect the hourly limit.

## 8. Configuration (`backend/.env`)

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | |
| `APP_URL` | `https://localhost:5173` | Browser origin; OAuth redirect URIs are built from it |
| `DATABASE_URL` | `postgresql://app:app@localhost:5432/scheduler` | |
| `REDIS_URL` | `redis://localhost:6379` | |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | |
| `SESSION_SECRET` | — | Signs the session JWT |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | — | |
| `SENDER_COUNT` | `3` | Ethereal senders created by `npm run seed` |
| `EMAIL_TRANSPORT` | `ethereal` | `dryrun` for load tests (sends nothing, records sends in Redis) |
| `QUEUE_PREFIX` | `bull` | Redis prefix for the queue and rate-limit keys; the load test uses its own |
| `WORKER_CONCURRENCY` | `5` | |
| `MIN_DELAY_BETWEEN_SENDS_MS` | `2000` | Per sender |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | |

## 9. Folder structure

```
backend/src/
  config.ts  app.ts  server.ts  worker.ts
  lib/        prisma.ts redis.ts logger.ts elastic.ts
  middleware/ requireAuth.ts errorHandler.ts
  modules/    auth/ campaigns/ emails/ slack/        (routes + service per module)
  modules/senders/transport.ts                        (pooled nodemailer transport per sender)
  queue/      emailQueue.ts emailWorker.ts rateLimiter.ts startupCheck.ts bullBoard.ts
backend/scripts/  seed.ts es-reindex.ts load-test.ts load-test-env.ts load-test-worker.ts
backend/tests/    schedule.test.ts rateLimiter.test.ts
backend/prisma/   schema.prisma

frontend/src/
  api/                client.ts + one file per resource
  components/ui/      Button Input Textarea Modal StatusBadge Spinner EmptyState Avatar
  components/layout/  AppLayout Sidebar UserMenu
  features/           auth/ emails/ (list, row, queries) compose/ (recipients, send later, toolbar) slack/
  pages/              LoginPage ScheduledPage SentPage ComposePage EmailDetailPage
  types/api.ts
  lib/                cn.ts queryClient.ts date.ts extractEmails.ts useDebounced.ts
  App.tsx             routes: /login, /scheduled, /sent, /compose, /emails/:id; /dashboard → /scheduled
```
