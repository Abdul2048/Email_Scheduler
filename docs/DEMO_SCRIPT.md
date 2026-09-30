# Demo script (under 5 minutes)

One campaign shows everything: scheduling, sending, a worker restart mid-batch, the per-sender hourly limit with deferral, and the Slack alert.

## Before recording

1. Infrastructure running (`npm run infra:native` or `docker compose up -d`) and Slack connected in the app (sidebar card shows the channel).
2. In `backend/.env`, set a small limit so it's reached on camera, and remember to set it back to `200` afterwards:
   ```
   MAX_EMAILS_PER_HOUR_PER_SENDER=3
   ```
3. Run the three processes in **separate terminals**, so the worker can be restarted alone:
   ```
   npm run dev:api -w backend
   npm run dev:worker -w backend
   npm run dev -w frontend
   ```
4. Have a `leads.csv` with 15 addresses ready (for example `[lead01@example.com](mailto:lead01@example.com)` … `[lead15@example.com](mailto:lead15@example.com)`).
5. Log out, and open https://localhost:5173 in one tab and the Slack channel in another.

The hourly counters are per clock hour, so a rehearsal in the same hour uses up part of the limit. Record at the start of a new hour, or expect fewer emails to go out before the deferral.

## Script

| Time | Show | Say |
| --- | --- | --- |
| 0:00 | Login page → **Login with Google** → Scheduled tab | "Real Google OAuth. The session is an httpOnly cookie." |
| 0:20 | **Compose** → **Upload List** with `leads.csv` → "15 email addresses detected". Subject, body, Delay **2** sec, Hourly Limit **200**, Send (now) | "Leads are cleaned and deduped in the browser. Each email becomes a BullMQ delayed job; there is no cron." |
| 0:50 | Scheduled tab: 15 emails with their times, count in the sidebar | "Postgres is the source of truth; three Ethereal senders are used in rotation." |
| 1:10 | Worker terminal: sends appear. **Press Ctrl+C in the worker terminal** after about 4 sends, wait 5 seconds, start it again | "The worker is down, jobs wait in Redis. On restart it continues where it left off." |
| 1:50 | Sent tab: no email appears twice. Worker log shows `Startup check complete` and continues | "Each email is claimed once in Postgres, and the send result is saved before the status, so a restart never sends twice." |
| 2:20 | Scheduled tab: 6 emails with an orange **Deferred** pill and next-hour times | "The per-sender limit is 3 per hour for this demo. Over-limit emails aren't failed; they move to the next hour in order. Minimum 2 seconds between sends per sender, enforced in Redis with Lua, across any number of workers." |
| 2:50 | Slack channel: one message per sender | "When a sender hits its limit, the user gets one Slack message per sender per hour." |
| 3:10 | Sent tab → open an email → **View the delivered message on Ethereal** | "Ethereal is a free fake SMTP service; this is the delivered message." |
| 3:40 | Search box: type part of the subject, then an address with `@` | "Search is Elasticsearch: partial, case-insensitive, subject or recipient." |
| 4:00 | Sidebar → **Queue dashboard** (Bull Board): delayed and completed jobs | "Bull Board shows the queue; it's behind login." |
| 4:30 | Done | "Details on architecture, restart safety, limits and trade-offs are in the README." |

## Afterwards

Set `MAX_EMAILS_PER_HOUR_PER_SENDER=200` again in `backend/.env` and restart the worker.
