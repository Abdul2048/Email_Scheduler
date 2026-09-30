# Requirements Traceability

Every requirement from `task.md` → the stage that delivers it → how we check it.
Tick **Done** only after the check actually passes.

## Tech

| # | Requirement | Stage | Check | Done |
| --- | --- | --- | --- | --- |
| T1 | TypeScript + Express backend | 1 | `npm run build` | ✅ |
| T2 | BullMQ + Redis | 2 | Bull Board shows the queue | ✅ |
| T3 | PostgreSQL | 1 | Prisma migration applied | ✅ |
| T4 | Ethereal SMTP | 2 | Preview link opens the email | ✅ |
| T5 | React + Tailwind + TypeScript | 6 | `frontend/` builds (checked by the regression suite) | ✅ |
| T6 | Redis/DB via Docker | 0 | `docker compose up -d` healthy. The native script is verified (including the fresh-folder test); the compose file is written but not run, as there is no Docker on the dev machine | ☐ |

## Backend — scheduler

| # | Requirement | Stage | Check | Done |
| --- | --- | --- | --- | --- |
| B1 | Accept scheduling requests via API | 2 | `POST /api/campaigns` | ✅ |
| B2 | Store in relational DB | 2 | `Email` rows exist | ✅ |
| B3 | BullMQ delayed jobs, no cron | 2 | Jobs show as *delayed*. `rg -i "cron\|agenda\|node-schedule" backend` finds nothing | ✅ |
| B4 | Multiple senders via Ethereal | 2 | Sent table shows ≥ 2 sender addresses | ✅ |
| B5 | Searchable via Elasticsearch | 5 | Search box finds emails by subject/address (API verified by the regression suite; search box in Stage 7) | ✅ |
| B6 | Live BullMQ dashboard | 2 | `/admin/queues` | ✅ |
| B7 | After restart, future emails still send on time | 3 | Restart test | ✅ |
| B8 | No duplicates, no restart from scratch | 3 | Restart test: each email sent exactly once | ✅ |

## Backend — throughput & limits

| # | Requirement | Stage | Check | Done |
| --- | --- | --- | --- | --- |
| R1 | Configurable worker concurrency | 4 | `WORKER_CONCURRENCY` | ✅ |
| R2 | Safe with parallel jobs | 4 | Lua test: 100 parallel calls stay within the limit; claim check | ✅ |
| R3 | Minimum delay between sends | 4 | Load test: actual gaps ≥ gap; real Ethereal, 2 processes: SMTP starts ≥ 2002 ms apart | ✅ |
| R4 | Delay documented in README | 8 | README §7 "Rate limiting and concurrency" and §6 | ✅ |
| R5 | Hourly limit per sender (multiple senders) | 4 | `MAX_EMAILS_PER_HOUR_PER_SENDER` | ✅ |
| R6 | Limits configurable, not hardcoded | 4 | All values come from `config.ts` | ✅ |
| R7 | Safe across workers (Redis counters `hour_window + sender`) | 4 | 2 worker processes, 0 violations | ✅ |
| R8 | Over limit → deferred to next hour, order kept, not dropped | 4 | 12 emails with limit 5 → 7 `DEFERRED` in order, 0 `FAILED` | ✅ |
| R9 | README explains enforcement + trade-offs | 8 | README §7 (Lua scripts, deferral, trade-offs) | ✅ |
| R10 | Defined behavior for 1000+ emails | 4 | `ARCHITECTURE.md` §5.3 + load test | ✅ |

## Backend — Slack

| # | Requirement | Stage | Check | Done |
| --- | --- | --- | --- | --- |
| S1 | "Connect Slack" → real OAuth | 5, 7 | Click-through to Slack consent (live, 2026-09-30; UI button in Stage 7) | ✅ |
| S2 | Store webhook per user | 5 | `SlackIntegration` row | ✅ |
| S3 | Live Slack message when the hourly limit is hit | 5 | Message in the channel (3 senders → 3 messages, none repeated in the same hour) | ✅ |
| S4 | Not connected → no crash | 5 | Trigger with no integration (regression suite) | ✅ |
| S5 | Connect later → works without redeploy | 5 | Reconnect + trigger (regression suite, local webhook) | ✅ |

## Hard constraints

| # | Requirement | Stage | Check | Done |
| --- | --- | --- | --- | --- |
| H1 | No cron of any kind | all | `rg -i "cron\|setInterval\|repeat:\|node-schedule\|agenda"` over `backend/src`, `frontend/src` and `backend/package.json` finds nothing | ✅ |
| H2 | Persistent across restarts | 3 | Restart test | ✅ |
| H3 | Not re-sent / not restarted from Day 1 | 3 | Restart test | ✅ |
| H4 | Idempotent: never sent twice | 3 | `jobId = emailId` + DB claim; restart tests 0 duplicates; load test (1000 emails, 2 processes) 0 duplicates | ✅ |

## Frontend

| # | Requirement | Stage | Check | Done |
| --- | --- | --- | --- | --- |
| F1 | Matches Figma | 6, 7 | Side-by-side with every screen in `docs/figma/` (login, Scheduled, Sent, Compose + Send Later, email detail) | ✅ |
| F2 | Real Google login → dashboard | 1, 6 | Manual | ✅ |
| F3 | Header: name, email, avatar | 6 | User card at the top of the sidebar, as in the Figma | ✅ |
| F4 | Logout | 6 | User menu → Logout → `/login`; protected pages then redirect to `/login` | ✅ |
| F5 | Tabs: Scheduled / Sent | 7 | Sidebar nav with live counts (Figma); counts match the lists (regression suite) | ✅ |
| F6 | "Compose New Email" button | 7 | Sidebar Compose → Compose New Email page | ✅ |
| F7 | Compose: subject, body | 7 | Form | ✅ |
| F8 | Upload CSV/text, show email count | 7 | "Upload List" + "N email addresses detected"; 1,000-lead CSV → 1,000 (regression suite) | ✅ |
| F9 | Start time, delay, hourly limit | 7 | Send Later card, Delay between 2 emails, Hourly Limit; 5 emails 2 s apart from the chosen start | ✅ |
| F10 | Schedule calls backend API | 7 | `POST /api/campaigns` → toast → Scheduled list | ✅ |
| F11 | Scheduled table: Email, Subject, Scheduled time, Status | 7 | Figma rows: recipient, time pill (+ "Deferred"), subject | ✅ |
| F12 | Sent table: Email, Subject, Sent time, Status | 7 | Figma rows: recipient, Sent/Failed pill, subject, sent time | ✅ |
| F13 | Loading + empty states | 7 | Spinner, empty state with Compose, "no results" for search | ✅ |
| F14 | Clean structure, reusable components, DRY | 6 | `components/ui/`, `components/layout/`, `api/`, `features/`, `pages/` | ✅ |
| F15 | TS types for API + props | 6 | `types/api.ts`, no `any`; regression suite checks each type's fields against the live API | ✅ |
| F16 | Error messages / toasts | 7 | Stop the API → error state with Retry ("Can't reach the server"); toasts for scheduling, upload, Slack | ✅ |

## Deliverables

| # | Requirement | Stage | Check | Done |
| --- | --- | --- | --- | --- |
| G1 | Runs after zip + copy to another machine | 8 | Fresh-folder test: `git archive` zip (0.9 MB) → new folder → README steps → real Google login → 3 emails sent via 3 new Ethereal senders, 2 s apart | ✅ |
| G2 | README: run backend (Express, Redis, DB, worker) | 8 | README §1, §5 | ✅ |
| G3 | README: run frontend | 8 | README §1, §5 | ✅ |
| G4 | README: Ethereal + env vars | 8 | README §4, §6 | ✅ |
| G5 | README: architecture (scheduling, persistence, limits, concurrency) | 8 | README §7 | ✅ |
| G6 | README: features mapped to backend/frontend | 8 | README §8 | ✅ |
| G7 | Demo-ready (create, tabs, restart, rate limit) | 8 | `docs/DEMO_SCRIPT.md`, planned at 4:30. Each step was verified live in Stages 2–7; the timed rehearsal happens when recording | ✅ |
| G8 | Assumptions / trade-offs noted | 8 | README §11 | ✅ |
| G9 | All `.md` except README in `./docs/` | all | `git ls-files "*.md"`: only `README.md` is outside `docs/` | ✅ |
| G10 | Only free tools and services | all | `DECISIONS.md` cost check | ✅ |
