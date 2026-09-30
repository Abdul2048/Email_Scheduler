# Decisions, Assumptions & Trade-offs

Items marked **(README)** are copied into the README's "Assumptions & trade-offs" section.

## Cost check: everything is free

| Need | What we use | Cost |
| --- | --- | --- |
| Database | PostgreSQL 16 (Docker) | Free, open source |
| Queue store | Redis 8 (Docker or native) | Free, open source |
| Search | Elasticsearch 8 (Docker, Basic license, security off locally) | Free |
| Queue dashboard | Bull Board | Free, open source |
| SMTP | Ethereal Email (created in code, no signup) | Free |
| Login | Google OAuth client in "Testing" mode | Free, no billing account needed |
| Slack | Free Slack workspace + Slack app with incoming webhook | Free |
| HTTPS for Slack redirect | `@vitejs/plugin-basic-ssl` on `https://localhost` | Free, no tunnel, no account |
| Everything else | npm packages (MIT/Apache) | Free |

Not used: paid tunnels, hosted Redis/DB/ES, Taskforce.sh, SendGrid/SES, any paid SaaS.

Note: Docker Desktop is free for personal use and small companies. If a large-company licence is a problem, Rancher Desktop or Podman (both free) run the same `docker-compose.yml`.

Without Docker (how the dev machine runs): `scripts/infra-native.ps1` downloads free portable Windows builds (official PostgreSQL and Elasticsearch zips, community `redis-windows` build of Redis 8) into `%USERPROFILE%\dev-infra` and starts them with the same settings. **(README)**

## Simplicity choices

| Choice | Instead of | Why |
| --- | --- | --- |
| One queue (`email-send`) | Separate queues for search indexing and Slack | Indexing and Slack are best-effort side calls. The reindex script covers any missed index updates |
| Two short Lua scripts: slot reservation (gap + hourly limit + overflow) and a send-time gap check | BullMQ limiter + separate counters + separate deferral logic | The BullMQ limiter is per queue, not per sender, and can't push work into the next hour window. The reservation covers all three rules atomically; the send-time check keeps the gap exact when a job runs late (found by the load test) |
| Dry-run transport that records sends in Redis | Mocking nodemailer in tests | The load test checks duplicates and gaps across real, separate worker processes |
| Compose "hourly limit" applied when send times are computed | A second Redis counter per campaign | Pure arithmetic when the campaign is created, with nothing to coordinate at runtime |
| Round-robin senders per campaign, shown as a read-only "Ethereal senders (rotating)" From chip | A "From" picker + senders API | The Figma's From field is kept for layout. Rotation shows multiple senders and spreads load, with no extra API |
| Regex email extraction in the browser | CSV parsing library | Handles CSV and plain text the same way |
| Vite + React | Next.js | The backend owns OAuth, so Next.js server features aren't needed |
| Vite HTTPS proxy (one origin) | CORS config + tunnel | Cookies and Slack's HTTPS rule both work with no setup |
| Plain-text secrets in local DB | Encryption at rest | Local demo with fake Ethereal credentials. Would be encrypted in production **(README)** |
| Figma login's email/password fields shown disabled, with a "use Google" hint | Building password auth | `task.md` requires real Google login only; the layout still matches Figma |
| Build the Figma email detail view; star, attachments and rich-text toolbar are visual only | Building them for real | Not in `task.md`; the detail view helps show what was sent, the rest would only add scope |

## Design decisions **(README)**

1. **No cron.** Sending is driven only by BullMQ delayed jobs. The only other "scan" is a one-time check when the worker boots.
2. **Postgres is the source of truth.** Jobs carry only `emailId`, and Elasticsearch can be rebuilt with `npm run es:reindex`.
3. **Minimum delay: 2 seconds between sends per sender** (`MIN_DELAY_BETWEEN_SENDS_MS=2000`). Slots are planned 2 s apart, and a send-time check in Redis also guarantees it for the actual SMTP start, even when a job runs late. Trade-off: a late send pushes the following ones back instead of catching up.
4. **Hourly limit: per sender, fixed UTC hour windows** in Redis (`MAX_EMAILS_PER_HOUR_PER_SENDER`). Trade-off: up to 2× the limit can go out within a 60-minute span that crosses an hour boundary. A sliding window would fix this at more cost.
5. **Over-limit emails are deferred, never failed.** They move to the next hour in their original order and show as `DEFERRED`. The limit is checked when an email is due to send, not when it's scheduled, so campaigns from different users that share a sender are limited together. Order is per sender, first come first served: jobs reserve slots in queue order, and only jobs racing across worker processes in the same instant can swap.
6. **No duplicate sends.** If a worker dies mid-send, the email is marked `FAILED` ("interrupted") rather than retried, because we can't know whether SMTP accepted it. We chose at-most-once over risking a duplicate.
7. **Search is eventually consistent** and best effort. An Elasticsearch outage never blocks scheduling or sending.

## Assumptions **(README)**

- A leads file is CSV or text. Anything that looks like an email address counts.
- Plain-text email bodies, no templates.
- One Slack channel per user.
- Local demo only (self-signed HTTPS certificate, ES security disabled).
- "1000+ emails" is shown with the dry-run transport, not by actually sending 1000 via Ethereal (the task allows this).

## Resolved questions

1. **Figma link:** provided and recorded in `PLAN.md` (Stage 0); screen exports are in `docs/figma/`.
2. **Figma "From" field:** kept as a read-only chip; sending stays round-robin (see the table above).
