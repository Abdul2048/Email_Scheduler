# ReachInbox Email Scheduler

A production-style email scheduler with a dashboard. Users sign in with Google, upload a list of leads, and schedule a campaign. Every email becomes a **BullMQ delayed job** (no cron). A worker sends it through **Ethereal** SMTP at the right time, respecting a **per-sender minimum delay and hourly limit** enforced in Redis across any number of workers. Everything survives restarts without re-sending, a **live Slack message** goes out when a sender hits its hourly limit, and all emails are searchable through **Elasticsearch**.

| Scheduled | Compose | Email detail |
| --- | --- | --- |
| ![Scheduled list](docs/screenshots/scheduled.png) | ![Compose](docs/screenshots/compose.png) | ![Email detail](docs/screenshots/email-detail.png) |

Everything here is free: open-source infrastructure, Ethereal (no signup), a Google OAuth client in testing mode, and a free Slack workspace.

---

## Contents

1. [Quick start](#1-quick-start)
2. [Google login setup](#2-google-login-setup-required)
3. [Slack setup](#3-slack-setup-optional-needed-for-the-rate-limit-alert)
4. [Ethereal email](#4-ethereal-email)
5. [Running the pieces](#5-running-the-pieces)
6. [Environment variables](#6-environment-variables)
7. [Architecture](#7-architecture)
8. [Features: backend and frontend](#8-features-backend-and-frontend)
9. [Tests](#9-tests)
10. [API and Postman](#10-api-and-postman)
11. [Assumptions and trade-offs](#11-assumptions-and-trade-offs)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Quick start

**Prerequisites**
- Node.js 20 or newer (22 recommended, see `.nvmrc`).
- One way to run PostgreSQL 16, Redis 8 and Elasticsearch 8:
  - **Docker** (Docker Desktop, Rancher Desktop or Podman). This is the way on macOS and Linux; allow Docker at least 2 GB of memory for Elasticsearch.
  - **Windows without Docker**: the included `scripts/infra-native.ps1` downloads portable builds (no admin rights needed). It is Windows-only.
- A Google OAuth client ([section 2](#2-google-login-setup-required)). Slack is optional ([section 3](#3-slack-setup-optional-needed-for-the-rate-limit-alert)).
- Internet access on first run (npm packages, and creating Ethereal accounts).

**Steps**

```bash
# 1. Start Postgres, Redis and Elasticsearch — pick ONE:
docker compose up -d          # Docker
npm run infra:native          # Windows without Docker (first run downloads ~700 MB into %USERPROFILE%\dev-infra)

# 2. Install, create backend/.env, migrate the database, create 3 Ethereal sender accounts
npm run setup

# 3. Put your Google OAuth client ID and secret into backend/.env (and Slack's, if you use it)

# 4. Start the API, the worker and the frontend
npm run dev
```

Open **https://localhost:5173** and accept the browser's warning about the self-signed certificate (once). Sign in with Google. Use `localhost` exactly: Google and Slack only accept the redirect URIs registered for it.
`npm run setup` is safe to run again: it keeps an existing `backend/.env`, and the seed only creates senders that are missing.

Stop the native infrastructure with `npm run infra:native:stop` (or `docker compose down`). Data is kept in both cases.

## 2. Google login setup (required)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create (or pick) a project. No billing account is needed.
2. **APIs & Services → OAuth consent screen**: choose **External**, fill in the app name and your email, and save. Leave it in **Testing** mode and add your Google account under **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: `https://localhost:5173/api/auth/google/callback`
4. Copy the client ID and secret into `backend/.env`:
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```
5. Restart `npm run dev` (the API reads `.env` when it starts).

## 3. Slack setup (optional, needed for the rate-limit alert)

1. Create a free workspace at [[slack.com/get-started](https://slack.com/get-started)](http://slack.com/get-started%5D(https://slack.com/get-started)) if you don't have one, and add a channel such as `#email-alerts`.
2. Go to [[api.slack.com/apps](https://api.slack.com/apps)](http://api.slack.com/apps%5D(https://api.slack.com/apps)) → **Create New App → From scratch**, name it, and pick your workspace.
3. **OAuth & Permissions**:
   - Redirect URLs → add `https://localhost:5173/api/integrations/slack/callback` → **Save URLs**.
   - Scopes → Bot Token Scopes → add `incoming-webhook`.
4. **Basic Information → App Credentials**: copy the Client ID and Client Secret into `backend/.env` as `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`, then restart `npm run dev`.
5. In the app, click **Connect Slack** (bottom of the sidebar), pick the channel, and allow. Use **Send test** to check it.

Without Slack credentials everything else works; the Slack card says "Slack isn't configured on the server".

## 4. Ethereal email

[Ethereal](https://ethereal.email) is a free fake SMTP service: it accepts mail and shows it in a web inbox, but never delivers it. **Nothing needs to be set up by hand.** `npm run setup` (the `seed` step) creates `SENDER_COUNT` (default 3) Ethereal accounts through Ethereal's API and stores their SMTP credentials in the `Sender` table. Campaigns rotate across these senders.

To see a sent email, open it in the **Sent** list and click **View the delivered message on Ethereal**. To browse a whole inbox, log in at [ethereal.email/login](https://ethereal.email/login) with a sender's address and password (`npx prisma studio` in `backend/` shows the `Sender` table).

## 5. Running the pieces

`npm run dev` runs all three processes with `concurrently`. They can also run on their own, which is how the restart demo works:

| Process | Command | What it does |
| --- | --- | --- |
| API | `npm run dev:api -w backend` | Express on `:4000`: auth, campaigns, emails, search, Slack, Bull Board |
| Worker | `npm run dev:worker -w backend` | BullMQ worker: sends emails, rate limiting, Slack alerts |
| Frontend | `npm run dev -w frontend` | Vite on `https://localhost:5173`, proxies `/api` and `/admin` to the API |
| Postgres, Redis, Elasticsearch | `docker compose up -d` or `npm run infra:native` | Ports 5432, 6379, 9200 |

- **Queue dashboard (Bull Board):** https://localhost:5173/admin/queues (sign in first). Also linked from the sidebar.
- **Type check / build:** `npm run build` builds both apps (the backend into `backend/dist`, runnable with `npm run start:api -w backend` and `npm run start:worker -w backend`).
- **Rebuild the search index** from Postgres at any time: `npm run es:reindex -w backend`.

## 6. Environment variables

All in `backend/.env` (created from `backend/.env.example` by `npm run setup`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `APP_URL` | `https://localhost:5173` | Browser origin. The Google and Slack redirect URIs are built from it |
| `PORT` | `4000` | API port |
| `LOG_LEVEL` | `info` | pino log level |
| `DATABASE_URL` | `postgresql://app:app@localhost:5432/scheduler` | PostgreSQL |
| `REDIS_URL` | `redis://localhost:6379` | Redis (queue + rate-limit counters) |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | Elasticsearch |
| `ES_INDEX` | `emails` | Index name |
| `SESSION_SECRET` | random (generated by setup) | Signs the session cookie, at least 32 characters |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | Required for login |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | — | Optional; enables Connect Slack |
| `SENDER_COUNT` | `3` | Ethereal sender accounts created by the seed |
| `EMAIL_TRANSPORT` | `ethereal` | `dryrun` sends nothing and records sends in Redis (tests) |
| `QUEUE_PREFIX` | `bull` | Redis key prefix for the queue and rate-limit keys |
| `WORKER_CONCURRENCY` | `5` | Jobs processed in parallel per worker process |
| `MIN_DELAY_BETWEEN_SENDS_MS` | `2000` | **Minimum gap between two sends from the same sender** |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | **Hourly limit per sender** |

## 7. Architecture

```
Browser ──https──▶ Vite (React app) ──proxy /api, /admin──▶ API (Express :4000) ──▶ PostgreSQL (source of truth)
                                                                │ enqueue            Redis (queue, AOF on)
                                                                ▼                    Elasticsearch (search copy)
                                                    Worker (BullMQ) ──SMTP──▶ Ethereal
                                                                    ──HTTPS─▶ Slack incoming webhook
```

The API and the worker are two entry points of one TypeScript codebase, so either can be restarted alone. Full details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### Scheduling

`POST /api/campaigns` cleans and dedupes the leads, then computes a send time for each email: start at the chosen start time, add the campaign's "delay between emails" each time, and when a one-hour block (counted from the start time) already holds the campaign's hourly limit, continue at the start of the next block. Senders are assigned round-robin. One transaction inserts the campaign and its emails. Then each email is added to the `email-send` queue as a **delayed job** with `jobId = emailId` and `delay = scheduledAt − now`. There is **no cron** anywhere; the only scan is a one-time check when a worker starts.

### Persistence on restart

- **Postgres is the source of truth** for every email and its status. A job only carries IDs.
- **Redis runs with AOF on**, so delayed jobs and rate-limit counters survive a Redis restart.
- **Worker startup check:** every `SCHEDULED`/`DEFERRED` email that has no job in Redis gets its job re-added (same `jobId`, so it can't be doubled). Emails that are already `SENT` are never queued again, so a batch never restarts from the beginning. Emails that fell due while everything was down are sent right after the restart, spaced out by the rate limiter.
- **No duplicate sends:** the worker claims an email with a conditional update (`SCHEDULED → SENDING`). After SMTP accepts it, the result is saved in the job before Postgres is updated, so a crash between the two never causes a second send. If a worker dies in the middle of an SMTP call, the email is marked `FAILED` ("interrupted") rather than risk sending it twice (at-most-once).

These were tested by hard-killing the API and worker mid-batch, killing the worker mid-send, force-killing Redis with pending jobs, and deleting a job by hand ([`docs/PLAN.md`](docs/PLAN.md), Stage 3).

### Rate limiting and concurrency

- **Minimum 2 seconds between sends per sender** (`MIN_DELAY_BETWEEN_SENDS_MS=2000`).
- **Hourly limit per sender** (`MAX_EMAILS_PER_HOUR_PER_SENDER=200`), counted in fixed UTC hour windows.
- Both are enforced by two short **Redis Lua scripts**, so they are atomic and correct across any number of worker processes and machines:
  1. **`reserveSendSlot`** runs when a job first becomes due. It gives the email the sender's next free slot: at least the minimum delay after the previous one, and in an hour that still has room. If the current hour is full, the slot moves to the next hour window, **in order**. The email is then parked as a delayed job until its slot and marked `DEFERRED` in the UI. Nothing is dropped or failed.
  2. **`acquireSendTurn`** runs right before SMTP and uses Redis' own clock. It guarantees the minimum gap between the *actual* sends, even when a job starts late (for example behind a burst of new jobs).
- **Concurrency:** `WORKER_CONCURRENCY` jobs per worker process (default 5), and you can run as many worker processes as you like. Every shared decision (claim, slot, turn) is atomic in Postgres or Redis; nothing is counted in memory.
- The Compose form's **Delay between 2 emails** and **Hourly Limit** shape the campaign's own schedule. The per-sender limits above always apply on top, because several campaigns and users share the same senders.

**Trade-offs:** fixed hour windows allow up to 2× the limit within a 60-minute span that crosses an hour boundary (a sliding window would cost more). A late send pushes the next ones back instead of catching up. The BullMQ built-in limiter was not used because it limits a whole queue, not each sender, and can't move work into the next hour.

### 1000+ emails at the same time

They are inserted and queued in chunks (well under a second). When they become due, each job reserves a slot and goes back to waiting until that slot. Each sender then sends one email every 2 seconds, with all senders in parallel. With 3 senders and 200/hour, about 600 go out in the first hour and the rest move, in order, into the following hours; the user gets one Slack message per sender per hour. `npm run load-test -w backend` checks this with 1,000 emails and two real worker processes: no duplicates, never over the limit, never closer than the gap, never before the scheduled time.

### Slack alert

When the worker defers an email because its sender's hourly limit is reached, it reads the user's Slack connection **from the database at that moment** and posts to their incoming webhook, at most once per user, sender and hour (a Redis `SET NX` key). Not connected means no message and no error; connecting or disconnecting takes effect immediately, without a restart. A Slack failure is logged and never affects sending.

### Search

Emails are copied into Elasticsearch after every change (best effort). The search box does a partial, case-insensitive match on the subject or recipient; every word must match, and a query containing `@` searches addresses only. Elasticsearch returns matching IDs; Postgres still filters by tab, sorts and paginates, so results are never stale in status.

## 8. Features: backend and frontend

| Feature | Backend | Frontend |
| --- | --- | --- |
| Google login, session, logout | `modules/auth` (OAuth code flow, httpOnly JWT cookie) | Login page, user card with Logout, protected routes |
| Schedule a campaign | `POST /api/campaigns`: lead cleanup, send-time calculation, DB transaction, BullMQ delayed jobs | Compose page: recipients, CSV/TXT upload with "N email addresses detected", subject, body, delay, hourly limit, Send Later start time |
| Sending | Worker: claim, rate limit, Ethereal SMTP via pooled transports, retries with backoff | Status pills: scheduled time, Deferred, Sent, Failed |
| Scheduled / Sent lists | `GET /api/emails?view=scheduled\|sent`, `GET /api/emails/counts` | Sidebar tabs with counts, lists refreshing every 5 s, paging, loading, empty and error states |
| Email detail | `GET /api/emails/:id` | Detail view with body and Ethereal link |
| Restart safety | Postgres state, Redis AOF, startup check, idempotent send | — |
| Per-sender delay + hourly limit | Redis Lua scripts, deferral to the next hour | "Deferred" pill with the new time |
| Slack alert | `modules/slack`: OAuth, webhook, one message per sender-hour | Slack card: Connect, channel, Send test, Disconnect |
| Search | Elasticsearch index + `q` parameter | Search box on both lists |
| Queue monitoring | Bull Board at `/admin/queues` (login required) | Link in the sidebar |

## 9. Tests

| Command | What it checks | Time |
| --- | --- | --- |
| `npm run test -w backend` | Vitest: schedule calculation, and the Lua scripts against real Redis (100 parallel reservations, hour rollover, gap, order) | seconds |
| `npm run load-test -w backend` | 1,000 emails, 2 worker processes, dry-run transport: duplicates, limits, gaps, order | ~30 s |
| `npm run test:regression` | Every stage's exit checks against real API and worker processes (58 checks): login, scheduling, restarts, limits, Slack (against a local fake webhook), search (including more than 1,000 matches), frontend build and API types, 1,000-lead CSV | ~2 min |

The load and regression tests are fully isolated: their own database (`scheduler_regression`, created automatically), Redis prefix and search index, and a transport that sends nothing. They need the infrastructure running but not `npm run dev`.

## 10. API and Postman

The full contract is in [`docs/API.md`](docs/API.md). All routes are under `/api` and return JSON.

To call the API from Postman, sign in through the browser first, copy the `session` cookie from the browser's dev tools, and send it as a `Cookie: session=...` header to `https://localhost:5173/api/...` with **SSL certificate verification turned off** (Postman settings). The cookie is `Secure`, so use the HTTPS address.

Example:
```http
POST https://localhost:5173/api/campaigns
Content-Type: application/json
Cookie: session=...

{
  "subject": "Hello",
  "body": "Hi there!",
  "leads": ["[a@example.com](mailto:a@example.com)", "[b@example.com](mailto:b@example.com)"],
  "startAt": "2026-10-01T10:00:00.000Z",
  "delayBetweenEmailsSec": 2,
  "hourlyLimit": 100
}
```

`sentAt` is the moment Ethereal accepted the email, usually 1–3 seconds after `scheduledAt` because of the SMTP round trip.

## 11. Assumptions and trade-offs

**Assumptions**
- A leads file is CSV or plain text; anything that looks like an email address counts, and duplicates are removed.
- Email bodies are plain text (the Figma formatting toolbar, attachments, star, archive and delete are drawn but not functional). The Figma's email/password login is shown but disabled; login is Google only, as the task requires.
- Emails are sent from a pool of Ethereal senders in rotation, shown as "Ethereal senders (rotating)" in the From field.
- One Slack channel per user.
- Local demo: self-signed HTTPS certificate, Elasticsearch security disabled, and Ethereal credentials stored in plain text in the local database (they would be encrypted in production).
- "1000+ emails" is demonstrated with the dry-run transport, not by sending 1,000 real Ethereal emails.

**Design decisions and trade-offs**
1. No cron. Sending is driven only by BullMQ delayed jobs.
2. Postgres is the source of truth; jobs only carry IDs; Elasticsearch can be rebuilt with `npm run es:reindex -w backend`.
3. Minimum 2 s between sends per sender, guaranteed for the actual SMTP start. A late send pushes later ones back.
4. Hourly limit per sender in fixed UTC hour windows (up to 2× within a 60-minute span across a boundary).
5. Over-limit emails are deferred in order, never failed. The limit is checked when an email is due, so campaigns sharing a sender are limited together.
6. At-most-once: an email interrupted mid-send is marked `FAILED` instead of risking a duplicate.
7. Search is eventually consistent; an Elasticsearch outage never blocks scheduling or sending (search returns 503 until it's back).
8. Single-origin HTTPS through the Vite proxy: cookies and Slack's HTTPS redirect rule work without CORS or a tunnel.

More in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## 12. Troubleshooting

| Problem | Fix |
| --- | --- |
| Browser says the connection isn't private | Expected for the local self-signed certificate: choose Advanced → Proceed. |
| Google says "Access blocked" or "app not verified" | Add your account under **Test users** on the OAuth consent screen, and check the redirect URI is exactly `https://localhost:5173/api/auth/google/callback`. |
| Login returns to the login page with an error | `GOOGLE_CLIENT_ID`/`SECRET` missing or wrong in `backend/.env`; restart `npm run dev` after editing it. |
| "Slack isn't configured on the server" | Add `SLACK_CLIENT_ID`/`SECRET` and restart. |
| `npm run setup` fails at `prisma migrate deploy` | Postgres isn't running yet: start it (step 1) and run setup again. |
| `npm run build` fails with `EPERM ... query_engine-windows.dll.node` | Windows locks Prisma's engine while the API or worker runs. Stop `npm run dev`, then build. |
| Port 5173 or 4000 already in use | Stop the other process, or change `PORT` (and `API_URL` for the frontend proxy). |
| "Search is temporarily unavailable" | Elasticsearch is down or still starting; scheduling and sending are unaffected. |
| "Can't reach the server" in the app | The API isn't running; start `npm run dev` again. |

## Project documents

| Document | Purpose |
| --- | --- |
| [`docs/task.md`](docs/task.md) | The assignment |
| [`docs/PLAN.md`](docs/PLAN.md) | Stages, scope and verification results |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Components, data model, queue flow, rate limiting, restart safety |
| [`docs/API.md`](docs/API.md) | REST contract |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Choices, cost check, assumptions, trade-offs |
| [`docs/REQUIREMENTS_TRACEABILITY.md`](docs/REQUIREMENTS_TRACEABILITY.md) | Every requirement → stage → how it was verified |
| [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) | The 5-minute demo |
| [`docs/figma/`](docs/figma/) | Figma screen exports |
| [`docs/samples/leads.csv`](docs/samples/leads.csv) | Sample leads file for the upload |
