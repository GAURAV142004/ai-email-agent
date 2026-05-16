# AI Email Agent — Complete Codebase Guide

> For AI agents and new contributors. Covers every layer of the system: auth, database, Gmail integration, AI pipeline, API routes, and frontend. Read top-to-bottom before making changes.

---

## 1. What This Project Does

A SaaS dashboard that connects to a user's Gmail inbox, reads emails, and uses an AI model to extract actionable tasks. Users see tasks in a dashboard, can filter/sort them, update statuses, and generate AI-drafted follow-up replies.

**Core loop:**
1. User logs in with Google OAuth → Gmail access token is stored.
2. Either (a) a Google Pub/Sub webhook fires when a new email arrives, or (b) the user manually triggers a sync from the Settings page.
3. For each new email thread: fetch full content via Gmail API → send to AI for analysis → store `email_threads` + `tasks` rows in Supabase.
4. Dashboard fetches tasks via REST API and subscribes to Supabase Realtime for live updates.

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) | React 19, TypeScript 5, server components where possible |
| Styling | Tailwind CSS v4 | `@custom-variant dark` for dark mode; `shadcn/tailwind.css` for component tokens |
| UI Components | shadcn/ui | Installed into `components/ui/` — do not edit generated files |
| Font | Inter (Google Fonts) | Loaded via `next/font/google`, injected as `--font-sans` CSS variable |
| Auth | NextAuth.js v4 | Google OAuth provider; session stored in JWT |
| Database | Supabase (PostgreSQL) | Row-level security enabled; service-role key used on server |
| Realtime | Supabase Realtime | `postgres_changes` channel on `tasks` table; dashboard auto-refreshes |
| AI | Google Gemini | `@google/generative-ai` v0.24.1; model `gemini-2.5-flash` |
| Email API | Gmail API v1 | `googleapis` npm package; OAuth2 credentials from connected account |
| Push notifications | Google Cloud Pub/Sub | Gmail watch → Pub/Sub topic → webhook POST to `/api/gmail/webhook` |
| Theme | `next-themes` | Class-based dark/light toggle; `ThemeProvider` in `components/Providers.tsx` |
| Validation | Zod v4 | API route request bodies validated with discriminated union schemas |
| Date formatting | `date-fns` v4 | `formatDate`, `formatDueDate`, `formatRelativeDate` helpers in `lib/utils.ts` |

---

## 3. Repository Structure

```
app/
  (auth)/login/page.tsx         — Login page (Google OAuth button)
  (dashboard)/
    layout.tsx                  — Sidebar + main content wrapper; dark bg
    page.tsx                    — Dashboard: stats + task table + follow-up dialog
    tasks/page.tsx              — All Tasks page (larger limit, no filter bar)
    settings/page.tsx           — Gmail watch setup + manual sync trigger
  api/
    auth/[...nextauth]/route.ts — NextAuth handler (Google provider config)
    gmail/
      setup/route.ts            — POST: registers Gmail watch, stores historyId
      sync/route.ts             — POST: manual sync of 20 recent inbox threads
      webhook/route.ts          — POST: Pub/Sub push endpoint (fast-ACK pattern)
    tasks/
      route.ts                  — GET list + POST create
      [id]/route.ts             — PATCH update + DELETE
    ai/analyze/route.ts         — POST: analyze thread OR generate follow-up draft
  globals.css                   — Tailwind config, CSS variable palette, keyframes
  layout.tsx                    — Root layout: Inter font, ThemeProvider, Providers

components/
  Providers.tsx                 — ThemeProvider + SessionProvider + TooltipProvider
  layout/
    Header.tsx                  — Sticky header; theme toggle (Sun/Moon); avatar dropdown
    Sidebar.tsx                 — Always-dark nav; active indicator; floating brand icon
  dashboard/
    DailyDigest.tsx             — 4 stat cards (Total / Pending / High Priority / Completed Today)
    TaskTable.tsx               — Sortable table; expandable rows; status dropdown
    TaskCard.tsx                — Expanded row detail: summary + metadata + email link
    StatusBadge.tsx             — Color-coded badge for task status
    PriorityBadge.tsx           — Dot + label badge for task priority

lib/
  auth.ts                       — getAuthenticatedUser(), getServiceSupabase()
  utils.ts                      — cn(), formatDate(), formatDueDate(), truncate()
  ai/
    analyze.ts                  — analyzeEmailThread(), generateFollowUpDraft()
    prompts.ts                  — buildEmailAnalysisPrompt(), buildFollowUpDraftPrompt()
  gmail/
    client.ts                   — getGmailClient(), refreshAccessToken()
    thread.ts                   — fetchThread(), fetchNewMessages(), extractBody()
    webhook.ts                  — decodePubSubMessage(), processWebhookNotification()
  supabase/
    client.ts                   — Browser Supabase client (anon key)
    server.ts                   — Server Supabase client (SSR cookies)
    types.ts                    — All TypeScript interfaces for DB tables
```

---

## 4. Environment Variables

All required. File: `.env.local` in the project root.

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # Server-only; never expose to client

# NextAuth
NEXTAUTH_URL=http://localhost:3000        # Change to production URL on deploy
NEXTAUTH_SECRET=<random-32-char-string>   # openssl rand -base64 32

# Google OAuth (Google Cloud Console → Credentials → OAuth 2.0 Client)
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx

# Google Pub/Sub (for real-time webhook)
GOOGLE_PUBSUB_TOPIC=projects/<project-id>/topics/<topic-name>

# Gemini AI
GEMINI_API_KEY=AIza...
```

**OAuth scopes required** (set in NextAuth Google provider):
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.modify` (needed for `watch()`)

---

## 5. Database Schema

Five tables in Supabase. RLS is enabled — server routes use `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS.

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | text unique | |
| name | text | |
| plan | text | `'free' \| 'pro' \| 'enterprise'` |
| created_at | timestamptz | |

### `connected_accounts`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| provider | text | `'gmail' \| 'outlook'` |
| email | text | The connected email address |
| access_token | text | Current OAuth access token |
| refresh_token | text | For token refresh |
| watch_expiry | timestamptz | When the Gmail watch expires (7 days) |
| **last_history_id** | text | **Critical**: cursor for Gmail History API (see §7) |
| status | text | `'active' \| 'inactive' \| 'error'` |
| created_at | timestamptz | |

> **Add the column if missing:**
> ```sql
> ALTER TABLE connected_accounts ADD COLUMN IF NOT EXISTS last_history_id TEXT;
> ```

### `email_threads`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | Internal ID (not Gmail thread ID) |
| user_id | uuid FK | |
| thread_id | text | Gmail thread ID (used for deduplication) |
| subject | text | |
| from_email | text | Extracted from `From:` header |
| received_at | timestamptz | Parsed from email `Date:` header |
| summary | text | 2–3 sentence AI-generated summary |
| email_link | text | `https://mail.google.com/mail/u/0/#inbox/<threadId>` |
| processed_at | timestamptz | |
| created_at | timestamptz | |

### `tasks`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| thread_id | uuid FK → email_threads | |
| user_id | uuid FK | |
| task | text | The extracted action item |
| status | text | `pending \| in_progress \| completed \| ignored` |
| priority | text | `high \| medium \| low` |
| assigned_to | text | Person name/email extracted by AI |
| due_date | date | Date extracted by AI |
| follow_up_sent | boolean | |
| created_at | timestamptz | |
| updated_at | timestamptz | Auto-updated by trigger |

### `ai_logs`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| thread_id | uuid FK | |
| user_id | uuid FK | |
| prompt | text | |
| response | text | JSON stringified AI response |
| model_used | text | `'gemini-2.5-flash'` |
| tokens_used | int | |
| created_at | timestamptz | |

---

## 6. Authentication Flow

**File:** `app/api/auth/[...nextauth]/route.ts`

1. User clicks "Continue with Google" on `/login`.
2. NextAuth redirects to Google's OAuth consent screen requesting Gmail scopes.
3. On success, NextAuth `signIn` callback fires:
   - Upserts a row in `users` table.
   - Upserts a row in `connected_accounts` with the `access_token` and `refresh_token`.
4. Session is stored as a JWT. `getServerSession(authOptions)` retrieves it in API routes.
5. `getAuthenticatedUser()` in `lib/auth.ts` wraps session lookup + Supabase `users` query — call this at the top of every protected API route.

**Token refresh**: `lib/gmail/client.ts → refreshAccessToken()` uses the stored `refresh_token` to get a new `access_token` when Gmail API calls fail. The Gmail client is created fresh per request via `getGmailClient(accessToken, refreshToken)`.

---

## 7. Email Processing Pipeline

There are **two paths** to process emails. Both converge at the same Supabase writes.

### Path A — Manual Sync (works locally)
**Endpoint:** `POST /api/gmail/sync`

```
Request → getAuthenticatedUser()
        → load connected_accounts for user
        → gmail.users.messages.list({ labelIds: ['INBOX'], maxResults: 20 })
        → deduplicate against existing email_threads (by thread_id)
        → for each new thread:
            fetchThread(threadId) → EmailThread object
            analyzeEmailThread(fullText, subject) → EmailAnalysisResult
            INSERT email_threads
            INSERT ai_logs
            INSERT tasks (if requires_action && tasks.length > 0)
        → await sleep(4000) between AI calls   ← rate limit guard (15 RPM free tier)
        → return { ok, processed, skipped }
```

### Path B — Real-time Webhook (requires public URL)
**Setup:** `POST /api/gmail/setup` registers a Gmail watch on the user's INBOX against a Google Pub/Sub topic. The watch expiry is stored in `connected_accounts.watch_expiry` and must be renewed every 7 days.

**Incoming:** `POST /api/gmail/webhook`

```
Pub/Sub push → decodePubSubMessage(body)   ← base64 decode + JSON parse
             → processWebhookNotification(notification)   ← fire-and-forget (fast ACK)
             → lookup connected_accounts by notification.emailAddress
             → startHistoryId = account.last_history_id ?? notification.historyId
             → UPDATE last_history_id = notification.historyId   ← advance cursor first
             → fetchNewMessages(accessToken, startHistoryId)   ← Gmail History API
             → for each new threadId: same INSERT flow as Path A
```

**Critical historyId bug (already fixed):** The Gmail History API returns events AFTER the given `startHistoryId`. Using the notification's `historyId` as `startHistoryId` returns an empty history window. The fix: store the historyId from `gmail.users.watch()` response as the initial cursor, then advance it to each notification's `historyId` before processing.

### Email Thread Fetching (`lib/gmail/thread.ts`)

`fetchThread(threadId, accessToken, refreshToken)`:
- Calls `gmail.users.threads.get({ format: 'full' })`
- Extracts `From`, `Subject`, `Date` headers from the first message
- Recursively extracts `text/plain` body from MIME parts via `extractBody()`
- Parses the raw email `Date` header with `new Date()` and converts to ISO string (handles formats like `"Thu, 14 May 2026 11:45:52 +0530 (IST)"`)
- Concatenates all messages as `fullText` for AI input
- Returns an `EmailThread` object

---

## 8. AI Analysis (`lib/ai/analyze.ts` + `lib/ai/prompts.ts`)

**Model:** `gemini-2.5-flash` via `@google/generative-ai` SDK  
**Key:** `process.env.GEMINI_API_KEY`

### `analyzeEmailThread(threadContent, subject) → EmailAnalysisResult`

Sends the full thread text to Gemini with a `systemInstruction` that enforces JSON-only output. The prompt (`buildEmailAnalysisPrompt`) asks for:

```json
{
  "summary": "2-3 sentences",
  "requires_action": true | false,
  "priority": "high | medium | low",
  "tasks": [
    {
      "task": "specific action item",
      "priority": "high | medium | low",
      "due_date": "YYYY-MM-DD or null",
      "assigned_to": "name/email or null"
    }
  ]
}
```

Markdown code fences are stripped from the response before `JSON.parse()` (Gemini sometimes wraps output in ` ```json ` blocks despite instructions).

**Rules enforced by prompt:**
- `requires_action = false` for newsletters, notifications, no-reply emails
- Extract ALL action items as separate task objects
- Infer due dates from natural language ("by Friday", "end of week")

### `generateFollowUpDraft(subject, threadContent, taskDescription) → FollowUpDraft`

Returns `{ subject: string, body: string }` for an AI-drafted reply email. Same JSON-stripping pattern applied. Used by the follow-up dialog on the dashboard.

---

## 9. API Routes Reference

All routes call `getAuthenticatedUser()` first and return `401` if not found.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/gmail/setup` | User session | Register Gmail watch; store `watch_expiry` + `last_history_id` |
| POST | `/api/gmail/sync` | User session | Manually process 20 latest inbox threads |
| POST | `/api/gmail/webhook` | None (Pub/Sub push) | Receive push notification; fast-ACK; async process |
| GET | `/api/tasks` | User session | List tasks; supports `?status=`, `?priority=`, `?limit=` |
| POST | `/api/tasks` | User session | Create task manually |
| PATCH | `/api/tasks/[id]` | User session | Update status, priority, due_date, assigned_to, or task text |
| DELETE | `/api/tasks/[id]` | User session | Delete task |
| POST | `/api/ai/analyze` | User session | `action: 'analyze'` → analyze thread; `action: 'followup'` → draft reply |

---

## 10. Frontend Structure

### Routing
- `/login` — Unauthenticated entry point; redirects to `/` if session exists
- `/` — Dashboard (DailyDigest stats + TaskTable + follow-up dialog)
- `/tasks` — All Tasks (full task list, no filter bar)
- `/settings` — Gmail watch + manual sync controls

### Layout
`app/(dashboard)/layout.tsx` renders `<Sidebar />` + `<main>`. The outer `<div>` has `bg-slate-50 dark:bg-[oklch(0.108_0.028_255)]`.

### Theme
Dark/light is handled by `next-themes` (`components/Providers.tsx`). The toggle button lives in `Header.tsx` and calls `setTheme('dark' | 'light')`. The `ThemeProvider` applies `class="dark"` to `<html>`. Tailwind picks it up via `@custom-variant dark (&:is(.dark *))` in `globals.css`. The Sidebar is always dark regardless of theme.

### Animations
Custom keyframes in `globals.css`:
- `animate-fade-in` — opacity 0→1 (0.4s)
- `animate-slide-up` — translateY(28px)→0 + fade (0.5s spring)
- `animate-slide-down` — for expanded TaskCard rows
- `animate-slide-in-left` — sidebar nav items
- `animate-number-pop` — stat card numbers (spring bounce)
- `animate-float` — sidebar brand icon (infinite gentle bob)
- `skeleton` / `dark .skeleton` — shimmer loading placeholder

### Key Components

**`DailyDigest`** — Receives all tasks, computes 4 counts client-side (total, pending, high-priority non-completed, completed-today). Each card has a colored `border-t-[3px]` accent and hover lift.

**`TaskTable`** — Single expandable table. Clicking a row toggles `TaskCard` below it via `expandedId` state. Status is changed via `DropdownMenu` without page reload. Uses `React.Fragment key={task.id}` to key the fragment containing both the row and its expanded card.

**`TaskCard`** — Expanded row detail. Shows AI summary (if present), assigned-to badge, due date badge, and "Open Email" link (direct Gmail URL).

**`StatusBadge` / `PriorityBadge`** — Pure display components. Colour config is an inline record — add new values there.

### Realtime Updates
Dashboard (`app/(dashboard)/page.tsx`) subscribes to Supabase Realtime:
```ts
supabase.channel('tasks-realtime')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => fetchTasks())
  .subscribe()
```
Any `INSERT`, `UPDATE`, or `DELETE` on the `tasks` table triggers a refetch. The channel is cleaned up in the `useEffect` return.

---

## 11. Known Issues & Fixed Bugs

| Bug | Status | Detail |
|---|---|---|
| Gmail historyId cursor wrong | **Fixed** | Was using `notification.historyId` as `startHistoryId` → empty history. Now stores initial historyId on watch setup; uses stored value as start; advances cursor before processing. |
| Timestamp parse failure | **Fixed** | Raw email `Date` header (e.g. `"Thu, 14 May 2026 11:45:52 +0530 (IST)"`) was passed directly to Postgres and rejected. Now parsed via `new Date()` → `.toISOString()`. |
| React key prop warning | **Fixed** | Bare `<>` fragment in `TaskTable.map()` had no key. Changed to `<React.Fragment key={task.id}>`. |
| `last_history_id` column missing | **Manual step needed** | TypeScript types include it; Supabase migration may not. Run: `ALTER TABLE connected_accounts ADD COLUMN IF NOT EXISTS last_history_id TEXT;` |
| Gemini 429 rate limit | **Mitigated** | 4-second sleep between AI calls in `/api/gmail/sync`. The free tier allows 15 RPM for `gemini-2.5-flash`. |

---

## 12. Local Development

```bash
# 1. Install dependencies
npm install

# 2. Set up .env.local (see §4)

# 3. Ensure last_history_id column exists in Supabase (see §11)

# 4. Start dev server
npm run dev        # http://localhost:3000

# 5. Login with Google → go to /settings → click "Sync Recent Emails"
#    (Pub/Sub webhook does NOT work on localhost; use manual sync)
```

**Pub/Sub on localhost** requires a public URL (e.g. `ngrok http 3000`) and a Pub/Sub push subscription pointing to `https://<ngrok-url>/api/gmail/webhook`.

---

## 13. Data Flow Diagram

```
Gmail Inbox
    │
    ├─ [Pub/Sub push] ──→ POST /api/gmail/webhook
    │                          │
    └─ [Manual sync] ───→ POST /api/gmail/sync
                               │
                       fetchThread() via Gmail API
                               │
                       analyzeEmailThread() via Gemini
                               │
                     ┌─────────┴──────────┐
                     ↓                    ↓
              email_threads           tasks table
                 (Supabase)           (Supabase)
                     │                    │
                     └──── Realtime ──────┘
                                │
                         Dashboard UI
                      (auto-refresh on change)
```

---

## 14. Adding Features — What to Know

- **New AI action**: add a case to `bodySchema` in `/api/ai/analyze/route.ts` and a new function in `lib/ai/analyze.ts` + `lib/ai/prompts.ts`.
- **New task field**: add to `tasks` table in Supabase → update `types.ts` → add to `updateTaskSchema` in `[id]/route.ts` → update `TaskCard.tsx` display.
- **New nav item**: add to `navItems` array in `Sidebar.tsx`.
- **Dark mode on a new component**: use `dark:` Tailwind prefix with `slate-*` colours (e.g. `bg-white dark:bg-slate-900`, `text-slate-800 dark:text-slate-100`, `border-slate-200 dark:border-slate-800`).
- **Adding a new page**: create under `app/(dashboard)/` — it automatically gets the Sidebar + Header layout.
