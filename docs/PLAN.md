# Implementation Plan — ReachInbox Email Scheduler

This is the master plan. Each stage has a **goal**, a **scope** (task checklist), and **exit criteria**
that must pass before the stage is closed.

Guiding rules:
- **Keep it simple.** Build exactly what `task.md` asks for, done well. No extra infrastructure, no speculative features.
- **Everything is free.** No paid services, no accounts that need a card (see `DECISIONS.md` → Cost check).

Companion docs (all `.md` files except `README.md` live in `./docs/`):

| Doc | Purpose |
| --- | --- |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Components, data model, queue flow, rate limiting, restart safety |
| [`API.md`](./API.md) | REST contract between frontend and backend |
| [`DECISIONS.md`](./DECISIONS.md) | Tech choices, cost check, assumptions, trade-offs, open questions |
| [`REQUIREMENTS_TRACEABILITY.md`](./REQUIREMENTS_TRACEABILITY.md) | Every requirement → stage → how it is verified |

---

## Stage overview

| # | Stage | Main outcome |
| --- | --- | --- |
| 0 | Setup | Repo skeleton, Docker infra, Google + Slack apps registered, local HTTPS |
| 1 | Backend core + Google login | Express/TS app, config, DB schema, real Google OAuth session |
| 2 | Scheduling pipeline | Compose API → DB → BullMQ delayed jobs → worker sends via Ethereal; Bull Board |
| 3 | Restart safety & idempotency | Restarts never lose, duplicate, or restart emails |
| 4 | Concurrency, delay & hourly limits | Redis-backed limits safe across workers; overflow moves to the next hour in order |
| 5 | Slack + Elasticsearch | Live Slack message on limit hit; emails searchable |
| 6 | Frontend foundation | Vite/React/Tailwind app, UI components, login, protected routes |
| 7 | Frontend features | Dashboard, tabs, tables, compose, search, Slack connect |
| 8 | README, fresh-machine test, demo prep | Zipped project runs elsewhere from the README alone |

Stages 6–7 can start once Stage 1 is done, because the API contract (`API.md`) is fixed.

**Rule: a stage is done only when `npm run test:regression` passes.** The suite re-runs the exit checks of every finished stage, not just the new one, against real API and worker processes. It's isolated from the dev stack: its own Postgres database (`scheduler_regression`), Redis prefix, Elasticsearch index, dry-run transport, and port 4100. It takes about 2 minutes. Each new stage adds its checks to `backend/scripts/regression.ts`. Checks that need a human or would disturb the dev stack are listed per stage and done by hand: live Google/Slack consent, a Redis restart, and Ctrl+C.

---

## Stage 0 — Setup

**Goal:** One command starts all infrastructure, and all free credentials needed later exist.

**Scope**
- [ ] Layout: `backend/`, `frontend/`, `docs/`, `README.md`, `docker-compose.yml`, `.gitignore`, `.nvmrc` (Node 22 LTS; Node 20+ works).
- [ ] `docker-compose.yml` with three services and named volumes:
  - `postgres:16`
  - `redis:8` with `--appendonly yes` (persist delayed jobs) and `--maxmemory-policy noeviction` (required by BullMQ)
  - `elasticsearch:8` with `discovery.type=single-node`, `xpack.security.enabled=false`, `ES_JAVA_OPTS=-Xms512m -Xmx512m`
- [ ] **No-Docker alternative** (used on the dev machine): portable, no-admin binaries in a folder outside the repo (`%USERPROFILE%\dev-infra`), with the same ports and settings as the compose file:
  - PostgreSQL 16: official EDB Windows zip (`initdb` + `pg_ctl`)
  - Redis 8: community `redis-windows` build (no official Windows build exists), started with `--appendonly yes --maxmemory-policy noeviction`
  - Elasticsearch 8: official Windows zip (bundled JDK), security disabled, 512 MB heap
  - `scripts/infra-native.ps1 start|stop|status` in the repo to download (first run), start, and stop them
- [ ] Local HTTPS: the Vite dev server runs on `https://localhost:5173` via `@vitejs/plugin-basic-ssl` and proxies `/api` and `/admin` to the backend on `:4000`. There's one origin for the browser, and Slack accepts the HTTPS redirect. No tunnel and no account needed.
- [ ] Google Cloud → OAuth client (Web). Redirect URI `https://localhost:5173/api/auth/google/callback`. Free, testing mode, add yourself as a test user.
- [x] Slack → create an app on a free workspace, scope `incoming-webhook`. Redirect URL `https://localhost:5173/api/integrations/slack/callback`.
- [ ] `backend/.env.example` with every variable (see `ARCHITECTURE.md` §7).
- [x] Get the **Figma link** (missing from `task.md`): [Outbox Labs Assignment](https://www.figma.com/proto/kOTwGlESjijCYnMgtHfvfU/Outbox-Labs-Assignment?node-id=59-4050&t=J3HeI7xEYgF503w9-1), screen exports in `docs/figma/`.

**Exit criteria**
- `docker compose up -d` (or `scripts/infra-native.ps1 start`) gives healthy Postgres (5432), Redis (6379), and Elasticsearch (9200).
- `https://localhost:5173` loads (after accepting the self-signed certificate once).
- Google and Slack apps show the redirect URLs above as saved.

---

## Stage 1 — Backend core + Google login

**Goal:** A clean Express + TypeScript service with validated config and DB schema, plus real Google login.

**Scope**
- [ ] TypeScript strict, `tsx` for dev, `tsc` for build.
- [ ] `config.ts`: read `.env`, validate with zod, fail fast. All limits and tunables come from here.
- [ ] Singletons: Prisma client, ioredis connection, pino logger. (The Elasticsearch client arrives with Stage 5.)
- [ ] Prisma schema + migration: `User`, `Sender`, `Campaign`, `Email`, `SlackIntegration` (`ARCHITECTURE.md` §3).
- [ ] Express app: `cookie-parser`, JSON body, one error handler (`{ error: { message } }`), `GET /api/health`.
- [ ] Two entry points: `src/server.ts` (API) and `src/worker.ts` (BullMQ worker). `npm run dev` starts both, and each can also start alone (needed for the restart demo).
- [ ] Google OAuth using `google-auth-library`:
  - `GET /api/auth/google` → Google consent (a random `state` stored in a cookie).
  - `GET /api/auth/google/callback` → check `state`, exchange the code, read name/email/picture from the ID token, upsert `User`, set an httpOnly session cookie (signed JWT), redirect to `/dashboard`.
  - `GET /api/auth/me`, `POST /api/auth/logout`.
- [ ] `requireAuth` middleware on all business routes and on Bull Board.

**Exit criteria**
- `npm run build` has no type errors.
- Logging in with a real Google account lands on `/dashboard`, and `/api/auth/me` returns name, email, and avatar.
- Protected routes return 401 without the cookie. After logout they return 401 again.

---

## Stage 2 — Scheduling pipeline

**Goal:** Emails from the Compose API are stored in Postgres, scheduled as **BullMQ delayed jobs** (no cron), and sent at the right time from **multiple Ethereal senders**. A live Bull Board shows the queue.

**Scope**
- [ ] `npm run seed`: create `SENDER_COUNT` (default 3) Ethereal accounts via Ethereal's free account API (`[api.nodemailer.com/user`](http://api.nodemailer.com/user); `createTestAccount()` caches one account per process) and save them as `Sender` rows. Skip if senders already exist.
- [ ] `POST /api/campaigns` with `{ subject, body, leads[], startAt, delayBetweenEmailsSec, hourlyLimit }`:
  1. Clean up the leads: trim, lowercase, drop invalid entries, drop duplicates.
  2. Compute each email's `scheduledAt` and assign senders round-robin (`ARCHITECTURE.md` §4).
  3. Insert the `Campaign` and all `Email` rows in one transaction.
  4. `queue.addBulk()` one job per email: `jobId = email.id`, `delay = scheduledAt − now`.
- [ ] Worker: load the email, claim it (`SCHEDULED → SENDING`), send with nodemailer, save `SENT` + `sentAt` + Ethereal `previewUrl`. On error, BullMQ retries 3 times with backoff; after the last attempt the email is `FAILED` with the error.
- [ ] `GET /api/emails?view=scheduled|sent&page=` for the two tabs.
- [ ] Bull Board (`@bull-board/express`) at `/admin/queues`, behind login.
- [ ] `EMAIL_TRANSPORT=dryrun` option (nodemailer JSON transport) for load testing without hitting Ethereal.

**Exit criteria**
- Schedule 5 emails starting 1 minute from now: they show as *delayed* in Bull Board, send on time, and appear as `SENT` with a working Ethereal preview link.
- Sent emails come from at least two different senders.
- No cron library anywhere: `rg -i "cron|agenda|node-schedule" backend` finds nothing.

---

## Stage 3 — Restart safety & idempotency

**Goal:** Stopping and restarting the API, the worker, or Redis never loses a future email, never sends one twice, and never starts a batch over.

**Scope**
- [ ] Redis AOF + Docker volumes (from Stage 0). Delayed jobs survive a Redis restart.
- [x] Idempotency layers:
  1. `jobId = email.id`: BullMQ refuses a second job for the same email.
  2. Worker claim: `UPDATE email SET status='SENDING' WHERE id=? AND status IN ('SCHEDULED','DEFERRED')`. If 0 rows update, do nothing.
  3. If a job starts and finds the email already `SENDING`, the previous run crashed mid-send. Mark it `FAILED` ("interrupted") instead of risking a duplicate.
  4. Once SMTP accepts an email, `{ sentAt, previewUrl }` is saved in the job data before the DB update, so a failed DB write is retried without re-sending.
- [x] Startup check (`queue/startupCheck.ts`, runs once when the worker boots; not cron): any `SCHEDULED`/`DEFERRED` email with no job in Redis gets its job re-added. Retries every 5 s if Redis/DB isn't reachable yet.
- [x] Graceful shutdown: on SIGINT/SIGTERM, `worker.close()` finishes in-flight sends, then closes connections.
- [x] API enqueue fails fast when Redis is down (503) and rolls the campaign back, so the client can safely retry.
- [x] One log line per Redis outage per connection ("lost" / "restored"), and one `SMTP accepted email` log per send (used to prove exactly-once).

**Exit criteria** (these become the demo's restart scenario)
- Schedule 10 emails over 2 minutes. After 3 are sent, stop everything (Ctrl+C), wait 30 s, and start again. The other 7 all send, each exactly once (DB rows and Ethereal inbox agree).
- `docker compose restart redis` while emails are pending: they still send.
- Delete one delayed job by hand in Bull Board and restart the worker: the startup check puts it back.

**Verified (2026-09-30)**. Every test force-killed processes (harsher than Ctrl+C). Exactly-once was checked by counting `SMTP accepted email` log lines per email:

| Test | Result |
| --- | --- |
| A. 10 emails 12 s apart; killed API + worker after 3 sent; down 30 s | 10/10 `SENT`, 1 SMTP acceptance each. The 3 already sent were not re-sent; the 4 that fell due during downtime went out right after restart (plus ~13 s first-SMTP-connection cost); the rest on time |
| B. Worker killed while an email was `SENDING` | After BullMQ's 30 s stalled-lock timeout, the email became `FAILED` "interrupted"; 0 re-sends |
| C. Redis force-killed with 3 delayed jobs | 3 delayed jobs present after restart (AOF); all sent on time; API and worker reconnected by themselves |
| D. One delayed job deleted, worker restarted | Startup check: `pending=2 requeued=1`; both sent once |

Graceful Ctrl+C can't be triggered from a script on Windows, so it gets shown live in the demo.

---

## Stage 4 — Concurrency, delay & hourly limits

**Goal:** Behave like a real email system under load. Parallel jobs are safe, sends are spaced out, the hourly limit is enforced in Redis across all workers, and emails over the limit move to the next hour **in order**, never dropped or failed.

**Scope**
- [x] `WORKER_CONCURRENCY` (default 5) passed to the BullMQ worker.
- [x] One Redis Lua script, `reserveSendSlot(senderId)`, enforces all of the following atomically (details in `ARCHITECTURE.md` §5):
  - **Minimum delay** between sends per sender: `MIN_DELAY_BETWEEN_SENDS_MS` (default **2000**).
  - **Hourly limit** per sender: `MAX_EMAILS_PER_HOUR_PER_SENDER` (default 200), counted in Redis keys `rl:{senderId}:count:{hourWindow}`.
  - **Overflow**: if the hour is full, the slot moves to the start of the next hour (then the next, if needed). Slots are handed out one after another, so order is preserved.
- [x] A second tiny Lua script, `acquireSendTurn`, checked right before SMTP. It keeps actual sends at least the gap apart even when a job runs late. The first load test showed why it's needed: jobs coming back from delayed wait behind a burst of new jobs.
- [x] Worker: reserve the slot as the job's first Redis call (`senderId` is in the job data, so reservations follow queue order). Save it in the job data and set the email's `scheduledAt` (and `DEFERRED` if the limit moved it to a later hour). Then move the job back to delayed (`moveToDelayed` + `DelayedError`, which doesn't use up a retry). A failed SMTP attempt clears the slot, so the retry reserves a new one.
- [x] The Compose form's hourly limit is applied when send times are computed (§4). The env limit is the hard cap enforced at send time.
- [x] `npm run load-test -w backend -- --count 1000`: separate worker processes, dry-run transport that records sends in Redis, isolated queue prefix. It checks duplicates, the hourly limit, planned and actual gaps, and never-early sends, then cleans up.
- [x] Vitest (against real Redis): 100 parallel reservations never exceed the limit; exact gaps; ordered overflow; gap-only rollover isn't a "deferral"; 20 parallel send-turn requests → exactly 1 granted; key expiries.

**Exit criteria**
- With `MAX_EMAILS_PER_HOUR_PER_SENDER=5`, 12 emails per sender scheduled "now" send 5 this hour, and 7 show as `DEFERRED` with next-hour times, in the original order, with 0 `FAILED`. (There are 3 senders round-robin, so the test uses 36 emails.)
- With 2 worker processes, sends from one sender are never closer than 2 s.
- The 1000-email load test reports 0 duplicates and 0 limit violations.

**Verified (2026-09-30)**

| Test | Result |
| --- | --- |
| Vitest | 13/13 pass (5 schedule + 8 rate limiter, against real Redis) |
| Load test, 1000 emails, 2 processes × concurrency 5, gap 100 ms, 200/sender/hour | 600 `SENT` + 400 `DEFERRED` into the next hour; 0 duplicates, 0 failed; max 200 per sender-hour; planned gaps ≥ 100 ms; actual gaps ≥ 85–99 ms as recorded in the transport (within the 25 ms measurement slack); 0 sent early; 9–11 adjacent out-of-order pairs |
| Load test, 300 emails, gap 1 s, 50/sender/hour | 150 + 150 `DEFERRED`; all checks pass; actual gaps ≥ 999 ms; lateness p99 0.5 s |
| Limit 5, 36 emails (12 per sender), 2 real worker processes, real Ethereal | Per sender: 5 `SENT`, 5 `DEFERRED` at hh:00:00/02/04/06/08 of the next hour and 2 at the hour after that, all in lead order; 0 `FAILED`; 1 SMTP acceptance each |
| Gap, 30 emails, 2 real worker processes, real Ethereal | Each sender's sends split across both processes; SMTP start gaps 2002–2083 ms (never below 2 s); 30 acceptances for 30 emails |
| Hour rollover (same run as the limit test) | At 20:00:00Z the 15 parked emails sent (5 per sender, lead order, 1 SMTP acceptance each, both processes); the last 6 stayed `DEFERRED` for 21:00Z |

Found along the way:
- **Late jobs could land right next to on-time ones.** BullMQ puts jobs that come back from delayed at the back of the wait list, behind any burst of new jobs. Fixed by the send-time guard (`acquireSendTurn`).
- **The ~13 s "first SMTP connection" cost (Stages 2–3) was DNS.** nodemailer's own DNS lookup took ~11 s on this network and is cached for only 5 minutes, so it came back after idle periods (at the rollover above, every send took 14–16 s and filled all worker slots). The transport now resolves the host once with the OS resolver (~90 ms) and connects by IP, keeping the hostname for TLS. Warm-up went from ~14 s to ~3 s.
- **Order within a burst:** out-of-order pairs dropped from 53 to 9–11 per 1000 once the slot is reserved before any DB call. The remaining swaps are two processes racing in the same millisecond.

---

## Stage 5 — Slack + Elasticsearch

**Goal:** Real Slack OAuth. A **live Slack message** goes out the moment a sender's hourly limit is hit. All emails are searchable through Elasticsearch.

**Slack scope**
- [x] `GET /api/integrations/slack/connect` → Slack authorize URL (`scope=incoming-webhook`, random `state` cookie).
- [x] `GET /api/integrations/slack/callback` → check `state`, call `oauth.v2.access`, save `webhookUrl`, team, and channel for the user, redirect to `/dashboard?slack=connected`.
- [x] `GET /api/integrations/slack` (status), `DELETE /api/integrations/slack` (delete the row), `POST /api/integrations/slack/test`.
- [x] When the hourly limit defers an email (the reservation's `deferred` flag, so gap-only rollovers don't count), the worker looks up the user's integration **in the DB right then**. If there is one, it POSTs a message to its webhook. Only one message per user, sender, and hour (`SET notify:{userId}:{senderId}:{hour} NX EX 7200`). The marker is removed if Slack fails, so the next deferral retries, and a (re)connect clears it. Wrapped in try/catch: no integration or a Slack error just logs, and sending continues.

**Elasticsearch scope**
- [x] Create the `emails` index on boot if missing (explicit strict mapping, `search_as_you_type` subject).
- [x] Index an email when it's created and again when its status changes. The document version is the row's `updatedAt`, so racing updates can't write an older state. Best effort: an ES error is logged and never blocks sending.
- [x] `GET /api/emails?q=...`: Elasticsearch finds the matching IDs (always filtered by `userId`); Postgres then filters by tab, sorts, and paginates. A lagging index can't show a wrong status.
- [x] `npm run es:reindex -w backend` rebuilds the index from Postgres.

**Exit criteria**
- Connect Slack, set the limit to 3, schedule 5 emails: a message appears in the Slack channel within seconds.
- Disconnect and trigger again: no message, no crash. Reconnect and trigger again: a message arrives, with no restart.
- Searching part of a subject or an address finds the email in both tabs.

**Verified so far (2026-09-30)**, in the regression suite (real Elasticsearch, a local stand-in for the Slack webhook, real API and worker processes): search by partial address or subject, tab filtering, per-user isolation; Slack status, OAuth redirect/503, forged state rejected; limit hit with no Slack → no message and no crash; connected → exactly one message per sender per hour; disconnected → none; Slack returning 500 → logged, sending unaffected; reconnect → messages resume, with no restart.
**Verified live (2026-09-30)** with a real Slack workspace (`#email-alerts`) and the real dev API and worker on Ethereal:
- OAuth click-through → Slack consent → back at `/dashboard?slack=connected`; the `SlackIntegration` row stores the team and channel.
- Hourly limit lowered to 14 with 12 already sent per sender this hour, then 12 new emails: 2 sent and 2 deferred per sender, and exactly **3 messages appeared in the channel**, one per sender.
- A second burst in the same hour: 3 more deferred, no new messages (one per sender per hour).
- Disconnect/reconnect is covered by the regression suite against a local webhook.

**Found along the way:** the request logger printed the session cookie. `logger.ts` now redacts cookies, the `authorization` header, and `set-cookie`.

---

## Stage 6 — Frontend foundation

**Goal:** A clean, typed React app with the Figma look, reusable components, and working login.

**Scope**
- [x] Vite + React + TypeScript + Tailwind. React Router, TanStack Query, `sonner` (toasts), `lucide-react` icons, Inter from `@fontsource-variable/inter` (bundled, no CDN).
- [x] Figma colors and font as Tailwind v4 `@theme` tokens in `src/index.css`.
- [x] Folder structure: `api/`, `components/ui/`, `components/layout/`, `features/`, `pages/`, `types/`, `lib/`.
- [x] UI components: `Button`, `Input`, `Textarea`, `Modal`, `StatusBadge`, `Spinner`, `EmptyState`, `Avatar`. The Figma uses a sidebar and list rows, not tabs and a table, so `Tabs`/`Table` became the sidebar `NavItem` here and an email row in Stage 7.
- [x] `types/api.ts`: interfaces for every request and response in `API.md`; typed clients in `api/` (auth, emails, campaigns, slack).
- [x] Login page as in the Figma (Google button → `/api/auth/google`, readable OAuth errors, disabled email/password fields), `useMe()`, `useLogout()`, `ProtectedRoute`.
- [x] Layout: sidebar with logo, user card (avatar, name, email, menu → Logout), Compose button, Scheduled/Sent nav. Routes `/scheduled`, `/sent`, `/compose`; `/dashboard` (the OAuth landing) redirects and keeps `?slack=...`.
- [x] Any 401 drops the user and returns to `/login`; if the API is down, a "Can't reach the server" screen with Retry instead of a blank page.

**Exit criteria**
- Login → dashboard works, refresh keeps the session, and logout goes back to login.
- `npm run build` has no type errors.

**Verified (2026-09-30)** in the browser: the login page matches `docs/figma/login_page.png`; the dashboard shell matches the sidebar in `home_scheduled.png`; the Scheduled/Sent nav and Compose work; a reload on `/sent` keeps the session; Logout → `/login`, and `/sent` then redirects to `/login`; the Google button opens Google's account chooser. The regression suite (46/46) adds Stage 6 checks: the frontend builds with no type errors, and `User`, `Page`, `EmailItem` and `SlackStatus` match the live API field for field.

---

## Stage 7 — Frontend features

**Goal:** A complete dashboard matching the Figma as closely as possible, with loading, empty, and error states everywhere.

**Scope**
- [x] Sidebar (Figma): user card with Logout, Compose, Scheduled/Sent with live counts (`GET /api/emails/counts`), Slack card, queue dashboard link.
- [x] Scheduled and Sent lists as Figma rows: recipient, status pill (scheduled time, "Deferred" when the hourly limit pushed it back, Sent/Failed), subject + body preview, sent time. The failure reason shows on hover.
- [x] Both lists: loading spinner, empty state with a Compose action, "no results" state, error state with Retry, search (debounced, Elasticsearch), refresh button, paging, refresh every 5 s.
- [x] Compose page (Figma): recipients as chips from typing, pasting or **Upload List** (CSV/TXT read in the browser, addresses extracted with a regex, deduped, **"N email addresses detected"**). Also Subject, Delay between 2 emails, Hourly Limit, Body, and the Figma "Send Later" card (date & time picker + presets) for the start time. The button reads Send / Send Later, is disabled while submitting, validates with the same bounds as the API, then shows a toast and opens the Scheduled list.
- [x] Slack card: **Connect Slack**, connected channel/workspace, Send test, Disconnect; the OAuth result (`?slack=connected` etc.) shows as a toast.
- [x] Email detail view (`docs/figma/email_read.png`) at `/emails/:id`: sender, recipient, time, status, failure reason, full body, link to the delivered message on Ethereal. Backed by `GET /api/emails/:id` (404 for other users' emails).
- [x] Figma-only elements (filter, star, archive, delete, attachments, rich-text toolbar) are drawn but do nothing.

**Exit criteria**
- Every requirement in `task.md` §Frontend is visibly met (checked with `REQUIREMENTS_TRACEABILITY.md`).
- Uploading a 1,000-lead CSV shows the right count, and scheduling creates 1,000 rows.
- Stopping the API shows an error toast/state instead of a blank screen.

**Verified (2026-09-30)** in the browser against the real dev stack:
- Compose: 6 typed addresses (one an uppercase duplicate) became 5 chips; the "Tomorrow, 10:00 AM" preset turned the button into "Send Later"; submitting showed "Scheduled 5 emails", opened Scheduled, and the count went 9 → 14 with the 5 emails 2 s apart from Thu 10:00:00.
- Lists: the Slack live-check emails showed as "Deferred" until 3:30 AM, then moved to Sent on their own. Clicking a row opens the detail view with the Ethereal link.
- Slack card: "Send test" returned 204 and posted to `#email-alerts`.
- API stopped: the list showed "Couldn't load emails" with Retry; a full reload showed "Can't reach the server" with Try again; after the API came back, Try again restored the dashboard.

The regression suite (57/57) adds Stage 7 checks: `EmailDetail` and `EmailCounts` match the frontend types; the detail has the full body; another user's email and a malformed id → 404; the counts match the list totals; search precision; and a 1,000-lead CSV (+50 duplicates, 3 junk rows) run through the browser's extractor gives exactly 1,000 addresses, and scheduling it creates 1,000 rows.

**Found along the way**
- Search matched on *any* word, so "ui-c" returned everything containing "check". Now every word must match (`operator: and`), and a query containing "@" searches addresses only.
- Typing addresses separated by commas left the text in the box when the input arrived in one go. The field now splits on commas, semicolons and spaces whenever the text changes.
- Vite's proxy returns a bare 500 when the API is down; the client now says "Can't reach the server" instead of "Request failed (500)".

---

## Stage 8 — README, fresh-machine test, demo prep

**Goal:** A reviewer can unzip the project on another machine and run it using only the README, and the demo fits in 5 minutes.

**Scope**
- [x] **README.md**:
  - Prerequisites (Node 20+, Docker or the native Windows script) and quick start: `docker compose up -d` (or `npm run infra:native`) → `npm run setup` → `npm run dev`.
  - Postman: call `https://localhost:5173/api/...` with SSL verification off (the session cookie is `Secure`).
  - Note that `sentAt` is when Ethereal accepted the email (adds about 1–3 s of SMTP time after the scheduled time).
  - How to run the backend (API + worker), the frontend, Redis/DB/ES.
  - Ethereal setup (automatic) and every env variable.
  - Google and Slack app setup, step by step.
  - Architecture: scheduling, persistence on restart, rate limiting and concurrency. State explicitly **"minimum 2 seconds between sends per sender"** and how the hourly limit works, with trade-offs.
  - Behavior with 1000+ emails at the same time.
  - Feature list mapped to backend and frontend.
  - Assumptions, shortcuts, and trade-offs (from `DECISIONS.md`).
- [x] `npm run setup` = install both apps + create `backend/.env` from the example with a random `SESSION_SECRET` (kept if it exists) + `prisma migrate deploy` + seed senders.
- [x] Zip without `node_modules`, `dist`, or `.env`, unzip into a new folder, follow the README exactly, fix anything that breaks.
- [x] `docs/DEMO_SCRIPT.md`: login → compose → scheduled tab → sent tab + Ethereal preview → restart scenario → rate limit + Slack message → Bull Board.

**Exit criteria**
- The fresh-folder run works from the README alone.
- Every row in `REQUIREMENTS_TRACEABILITY.md` is ticked.
- The demo rehearsal takes less than 5 minutes.

**Verified (2026-09-30)**
- Zip: `git archive --format=zip -o reachinbox-email-scheduler.zip HEAD` (0.9 MB; gitignored files such as `node_modules`, `dist` and `.env` are never included).
- Fresh folder, following the README: `npm run infra:native` → `npm run setup` (74 s: install, `.env` created with a random secret, `prisma migrate deploy` created the empty database and applied both migrations, 3 new Ethereal senders) → Google/Slack credentials added → `npm run dev` → real Google login → Compose, 3 recipients → all 3 `SENT` 2 s apart from 3 different senders, each with an Ethereal preview. It ran against its own database, queue prefix and index so the dev data wasn't touched.
- Traceability: every row ticked except T6 (`docker compose` is written but not run; there is no Docker on the dev machine, and the native script is the verified path).
- Demo: the script is planned at 4:30 and combines restart and rate limit in one 15-email campaign; every step was verified live in earlier stages. The timed rehearsal happens when recording.
- Regression suite (all stages): passes.

**Found along the way**
- A new unzip generates a new self-signed certificate, so the browser shows the "not private" warning again. Expected, and covered in the README troubleshooting table.
- `npm run setup` needed `backend/.env` to exist first (the seed reads config). Setup now creates it from `.env.example`, with a random `SESSION_SECRET`.
