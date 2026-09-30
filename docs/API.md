# API Contract

Base path `/api`, JSON everywhere, times are ISO-8601 UTC. Auth is the httpOnly session cookie.
Every route except `/auth/*` and `/health` returns 401 without it.
Errors: `{ "error": { "message": "..." } }` with a matching 4xx/5xx status.

## Auth
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/auth/google` | Redirect to Google |
| GET | `/auth/google/callback` | Sets cookie, redirects to `/dashboard` |
| GET | `/auth/me` | `User` |
| POST | `/auth/logout` | 204 |

## Campaigns
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/campaigns` | Body `CreateCampaignRequest` → 201 `CreateCampaignResponse` |

## Emails
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/emails?view=scheduled\|sent&page=1&q=` | `Page<EmailItem>`. With `q` (partial, case-insensitive match on subject or address; every word must match; a `q` containing `@` matches the address only), Elasticsearch finds the matches and Postgres filters them by tab, sorts, and paginates. 503 if Elasticsearch is down |
| GET | `/emails/counts` | `EmailCounts` for the sidebar |
| GET | `/emails/:id` | `EmailDetail`; 404 if it doesn't exist or belongs to another user |

## Slack
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/integrations/slack/connect` | Redirect to Slack (`scope=incoming-webhook`); 503 if Slack isn't configured |
| GET | `/integrations/slack/callback` | Saves webhook, redirects to `/dashboard?slack=connected` (or `cancelled`, `invalid_state`, `error`) |
| GET | `/integrations/slack` | `SlackStatus` |
| POST | `/integrations/slack/test` | 204, posts a test message; 400 if not connected; 502 if Slack rejects it |
| DELETE | `/integrations/slack` | 204 |

## Other
| Path | Notes |
| --- | --- |
| GET `/health` | `{ status: "ok" }` |
| `/admin/queues` | Bull Board (login required) |

## Types

```ts
interface User { id: string; name: string; email: string; avatarUrl: string | null }

interface CreateCampaignRequest {
  subject: string;
  body: string;
  leads: string[];               // server cleans + dedupes again
  startAt: string;               // ISO, not in the past
  delayBetweenEmailsSec: number; // >= 0 (the 2 s per-sender minimum still applies at send time)
  hourlyLimit: number;           // >= 1
}

interface CreateCampaignResponse { id: string; totalCount: number; invalidCount: number; duplicateCount: number }

type EmailStatus = 'SCHEDULED' | 'DEFERRED' | 'SENDING' | 'SENT' | 'FAILED';

interface EmailItem {
  id: string; toEmail: string; subject: string; bodyPreview: string; senderEmail: string; status: EmailStatus;
  scheduledAt: string; sentAt: string | null; previewUrl: string | null; error: string | null;
}

interface EmailDetail extends EmailItem { body: string }

interface EmailCounts { scheduled: number; sent: number }

interface Page<T> { items: T[]; page: number; pageSize: number; total: number }

interface SlackStatus { configured: boolean; connected: boolean; teamName: string | null; channelName: string | null }
```
