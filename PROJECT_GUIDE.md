# AI Email Agent — Complete Project Guide

> **Purpose:** Definitive reference for any AI agent, developer, or model working in this codebase. Covers every file, data model, API route, integration, data flow, and architectural decision. Read this file fully before making any changes.

---

## Table of Contents

1. [What This Project Does](#1-what-this-project-does)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Stack](#3-technology-stack)
4. [Repository Structure](#4-repository-structure)
5. [Environment Variables](#5-environment-variables)
6. [Database Schema](#6-database-schema)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Role System & Visibility Rules](#8-role-system--visibility-rules)
9. [Email Processing Pipeline](#9-email-processing-pipeline)
10. [AI Analysis Pipeline](#10-ai-analysis-pipeline)
11. [PII Detection & Masking](#11-pii-detection--masking)
12. [Token Encryption](#12-token-encryption)
13. [Gmail Integration](#13-gmail-integration)
14. [API Routes Reference](#14-api-routes-reference)
15. [Library Files](#15-library-files)
16. [Frontend Architecture](#16-frontend-architecture)
17. [Real-Time Updates](#17-real-time-updates)
18. [Cron Jobs](#18-cron-jobs)
19. [Email Invite System](#19-email-invite-system)
20. [SLA Monitoring](#20-sla-monitoring)
21. [AI Agent Conversation Feature](#21-ai-agent-conversation-feature)
22. [Security Implementation](#22-security-implementation)
23. [Testing](#23-testing)
24. [Development & Deployment](#24-development--deployment)
25. [Known Issues & Fixes](#25-known-issues--fixes)
26. [Data Flow Diagrams](#26-data-flow-diagrams)

---

## 1. What This Project Does

A **multi-user SaaS dashboard** for a software delivery team that:

- Connects each team member's Gmail inbox via Google OAuth
- Receives real-time email notifications through Google Pub/Sub webhooks
- Analyzes incoming emails with **AWS Bedrock (Amazon Nova Lite v1)** to extract tasks, summaries, and priority levels
- Stores all threads, tasks, and AI results in **Supabase (PostgreSQL)**
- Provides a role-based dashboard where team members view their tasks, draft AI-powered replies, and track SLAs
- Gives the **delivery_lead** a full-team monitoring view with response time tracking

**Core loop:**
```
Gmail inbox receives email
    → Google Pub/Sub push notification → /api/gmail/webhook
    → Fetch full thread from Gmail API
    → Pre-filter (skip automated/newsletter emails)
    → Mask PII → Analyze with AWS Bedrock
    → Store email_threads + tasks + ai_logs in Supabase
    → Supabase Realtime pushes update to browser
    → Dashboard shows new tasks instantly
```

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           BROWSER (Next.js)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │Dashboard │  │ TaskTable│  │ Monitor  │  │Agent Conversation│   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       └─────────────┴─────────────┴──────────────────┘             │
│                         REST API calls + Supabase Realtime          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                    NEXT.JS API ROUTES (Vercel Edge)                 │
│  /api/auth   /api/gmail/*   /api/ai/*   /api/tasks   /api/threads  │
│  /api/users  /api/team      /api/me     /api/monitor /api/agent    │
│  /api/cron                                                          │
└──────┬───────────────┬───────────────┬───────────────┬─────────────┘
       │               │               │               │
       ▼               ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌──────────────┐ ┌──────────────┐
│  Supabase   │ │  Gmail API  │ │ AWS Bedrock  │ │   Supabase   │
│ PostgreSQL  │ │ (googleapis)│ │ Amazon Nova  │ │  Realtime    │
│ + RLS       │ │             │ │ Lite v1      │ │  WebSocket   │
└─────────────┘ └──────┬──────┘ └──────────────┘ └──────────────┘
                        │
               ┌────────▼────────┐
               │ Google Pub/Sub  │
               │ (push webhook)  │
               └─────────────────┘
```

---

## 3. Technology Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Framework | Next.js | 16.x (App Router) | SSR + API routes + server components |
| Runtime | Node.js | 18+ | JavaScript runtime |
| Language | TypeScript | 5 | Strict mode |
| Frontend | React | 19.2.4 | Server + client components |
| Styling | Tailwind CSS | 4 | Utility-first; `@custom-variant dark` for dark mode |
| UI Components | shadcn/ui | Latest | Installed in `components/ui/` — do NOT edit generated files |
| Auth | NextAuth.js | 4.24.14 | Google OAuth provider; JWT sessions |
| Database | Supabase | PostgreSQL | Row-Level Security enabled |
| DB Client | @supabase/supabase-js | 2.105.4 | Anon key (client) + service role key (server) |
| Realtime | Supabase Realtime | — | `postgres_changes` WebSocket channel |
| AI Model | AWS Bedrock | — | Amazon Nova Lite v1 (`amazon.nova-lite-v1:0`) |
| AWS SDK | @aws-sdk/client-bedrock-runtime | 3.x | `InvokeModelCommand` |
| Anthropic SDK | @anthropic-ai/sdk | — | Also present (may be used for agent feature) |
| Email API | Gmail API v1 | — | `googleapis` npm; read, reply, watch |
| SMTP | Nodemailer | 7.0.13 | Gmail SMTP for invite emails |
| Pub/Sub | Google Cloud Pub/Sub | — | Push webhook for real-time Gmail events |
| Validation | Zod | 4.4.3 | API route request body schemas |
| Date utils | date-fns | 4.1.0 | `formatDate`, `formatDueDate`, `formatRelativeDate` |
| Tables | @tanstack/react-table | 8.21.3 | TaskTable sorting/filtering |
| Rich Text | Tiptap | 3.23.4 | ReplyComposer editor |
| Charts | Recharts | 3.8.1 | Monitor page stats |
| Icons | lucide-react | 1.16.0 | All UI icons |
| Theme | next-themes | 0.4.6 | Dark/light toggle |
| Toasts | sonner | 2.0.7 | Notification toasts |
| CSS Utils | clsx + tailwind-merge | — | `cn()` helper in `lib/utils.ts` |
| Testing | Vitest | 4.1.6 | Unit tests in `__tests__/` |
| Linting | ESLint | 9 | `eslint.config.mjs` |

---

## 4. Repository Structure

```
ai-email-agent/
├── app/                          ← Next.js App Router
│   ├── layout.tsx                ← Root layout: Inter font, Providers wrapper
│   ├── globals.css               ← Tailwind config, CSS variables, keyframes
│   ├── favicon.ico
│   ├── (auth)/
│   │   └── login/page.tsx        ← Login page with "Continue with Google" button
│   ├── (dashboard)/
│   │   ├── layout.tsx            ← Dashboard shell: Sidebar + Header + main content
│   │   ├── page.tsx              ← Main dashboard: stats + TaskTable + dialogs
│   │   ├── tasks/page.tsx        ← All Tasks page (full list, no filter bar)
│   │   ├── team/page.tsx         ← Team members view (senior+ roles only)
│   │   ├── monitor/page.tsx      ← SLA monitoring (delivery_lead only)
│   │   ├── agent/page.tsx        ← AI agent conversation UI
│   │   └── settings/
│   │       ├── page.tsx          ← Gmail watch setup + manual sync button
│   │       └── users/page.tsx    ← Manage team members (managers only)
│   └── api/                      ← API route handlers
│       ├── auth/[...nextauth]/route.ts   ← NextAuth.js handler
│       ├── gmail/
│       │   ├── setup/route.ts    ← Register Gmail watch (7-day TTL)
│       │   ├── sync/route.ts     ← Manual sync 20 recent threads
│       │   ├── webhook/route.ts  ← Pub/Sub push receiver (fast-ACK)
│       │   ├── search/route.ts   ← Gmail search
│       │   └── reply/route.ts    ← Send reply via Gmail API
│       ├── ai/
│       │   ├── analyze/route.ts  ← Analyze thread OR generate reply draft
│       │   └── draft/route.ts    ← Draft follow-up (role-based, rate-limited)
│       ├── tasks/
│       │   ├── route.ts          ← GET list + POST create
│       │   └── [id]/route.ts     ← PATCH update + DELETE
│       ├── threads/
│       │   ├── route.ts          ← GET list (paginated, role-filtered)
│       │   ├── [id]/route.ts     ← GET thread detail + canView() check
│       │   └── [id]/timeline/route.ts  ← GET message timeline
│       ├── agent/
│       │   ├── query/route.ts              ← AI agent search + analysis
│       │   ├── conversations/route.ts      ← GET list + POST create conversation
│       │   └── conversations/[id]/route.ts ← GET conversation + messages
│       ├── users/
│       │   ├── route.ts          ← GET list + POST create member + invite
│       │   └── [id]/route.ts     ← GET + PATCH update + POST invite
│       ├── team/
│       │   └── assignments/route.ts  ← GET + POST manager-subordinate
│       ├── me/
│       │   ├── stats/route.ts    ← Personal response time stats
│       │   └── pending/route.ts  ← Personal pending emails
│       ├── monitor/
│       │   ├── stats/route.ts    ← Team monitoring (delivery_lead only)
│       │   └── overdue/route.ts  ← Overdue thread list
│       └── cron/
│           ├── daily/route.ts         ← Combined: mark overdue + renew watches
│           ├── mark-overdue/route.ts  ← Mark pending threads as overdue
│           └── renew-watches/route.ts ← Renew expiring Gmail watches
│
├── components/
│   ├── Providers.tsx             ← NextAuth SessionProvider + ThemeProvider + Supabase
│   ├── layout/
│   │   ├── Header.tsx            ← Top bar: theme toggle, avatar dropdown, logout
│   │   ├── Sidebar.tsx           ← Left nav (always dark bg); role-based nav items
│   │   └── DashboardShell.tsx    ← Wrapper for sidebar + main
│   ├── dashboard/
│   │   ├── DailyDigest.tsx       ← 4 stat cards: Total, Pending, High-Priority, Done
│   │   ├── TaskTable.tsx         ← Sortable table with expandable rows; pagination
│   │   ├── TaskCard.tsx          ← Expanded row detail: subject, assigned, due, summary
│   │   ├── TaskDetailPanel.tsx   ← Side-panel for full task details
│   │   ├── ThreadDetailPanel.tsx ← Side-panel for full thread view
│   │   ├── ThreadTree.tsx        ← Email thread as message tree
│   │   ├── ThreadTimeline.tsx    ← Messages in timeline format
│   │   ├── StatusBadge.tsx       ← Colored status indicator (pending/in_progress/etc)
│   │   ├── PriorityBadge.tsx     ← Colored priority indicator
│   │   ├── ResponseBadge.tsx     ← Reply status badge
│   │   ├── ReplyComposer.tsx     ← Tiptap editor for drafting + sending replies
│   │   ├── GmailSearchPanel.tsx  ← Gmail search interface
│   │   └── NotificationBell.tsx  ← Unread notification indicator
│   ├── users/
│   │   └── UserForm.tsx          ← Form for creating/editing team members
│   └── ui/                       ← shadcn/ui generated components (do not edit)
│       └── [button, card, dialog, badge, input, label, textarea,
│             table, tabs, select, dropdown-menu, popover, tooltip,
│             avatar, calendar, collapsible, ...]
│
├── lib/                          ← Server-side business logic
│   ├── auth.ts                   ← getAuthenticatedUser(), getMemberFromSession(), getServiceSupabase()
│   ├── crypto.ts                 ← encryptToken(), decryptToken(), safeDecrypt()
│   ├── roles.ts                  ← TeamRole type, VISIBILITY_MAP, canView(), canReply(), getNavItems()
│   ├── utils.ts                  ← cn(), formatDate(), formatDueDate(), formatRelativeDate()
│   ├── supabase/
│   │   ├── client.ts             ← Browser Supabase client (anon key, RLS active)
│   │   ├── server.ts             ← SSR Supabase client (anon key via cookies)
│   │   └── types.ts              ← TypeScript types for all DB tables
│   ├── ai/
│   │   ├── analyze.ts            ← analyzeEmailThread(), generateFollowUpDraft(), quickClassifyEmail()
│   │   ├── prompts.ts            ← buildEmailAnalysisPrompt(), buildFollowUpDraftPrompt()
│   │   └── pre-filter.ts         ← shouldSkipAIAnalysis(), cleanEmailForAI()
│   ├── gmail/
│   │   ├── client.ts             ← getGmailClient(), refreshAccessToken()
│   │   ├── thread.ts             ← fetchThread(), fetchNewMessages()
│   │   ├── message-processor.ts  ← processThreadMessages() — build message timeline
│   │   ├── reply.ts              ← sendGmailReply(), getLastMessageId()
│   │   └── webhook.ts            ← decodePubSubMessage(), processWebhookNotification()
│   ├── pii/
│   │   ├── masker.ts             ← maskPII() — returns MaskResult
│   │   └── patterns.ts           ← PII_PATTERNS array (regex + replacement rules)
│   ├── email/
│   │   ├── sender.ts             ← sendInviteEmail() via Nodemailer/Gmail SMTP
│   │   └── invite-template.ts    ← buildInviteEmailHtml() template builder
│   └── tasks/
│       └── auto-update.ts        ← autoUpdateThreadTasks() — update tasks when reply sent
│
├── types/
│   └── next-auth.d.ts            ← NextAuth session type augmentation (adds role, memberId, etc.)
│
├── supabase/                     ← Supabase migration SQL files
├── __tests__/
│   ├── pii.test.ts               ← PII masking unit tests
│   └── roles.test.ts             ← Role visibility unit tests
│
├── public/                       ← Static assets
├── .env.local                    ← Environment variables (git-ignored in production)
├── .env.example                  ← Template for required env vars
├── next.config.ts                ← Security headers, Next.js config
├── tsconfig.json                 ← TypeScript config (paths: @/* → src/*)
├── package.json                  ← Dependencies + scripts (dev, build, start, lint)
├── vercel.json                   ← Vercel deployment config
├── components.json               ← shadcn/ui config
└── proxy.ts                      ← Proxy server config (development)
```

---

## 5. Environment Variables

All variables must be in `ai-email-agent/.env.local`. Never commit secrets.

| Variable | Required | Description | Example / Source |
|----------|----------|-------------|-----------------|
| `NEXTAUTH_URL` | Yes | Full URL of deployed app | `https://yourapp.vercel.app` |
| `NEXTAUTH_SECRET` | Yes | JWT signing secret (32+ chars) | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID | `*.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret | `GOCSPX-*` |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL | `https://*.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon JWT (public) | From Supabase dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service key (server-only, bypasses RLS) | From Supabase dashboard |
| `AWS_ACCESS_KEY_ID` | Yes | AWS IAM key ID | From AWS IAM |
| `AWS_SECRET_ACCESS_KEY` | Yes | AWS IAM secret | From AWS IAM |
| `AWS_REGION` | Yes | AWS region | `ap-south-1` |
| `BEDROCK_MODEL_ID` | No | Bedrock model ID | `amazon.nova-lite-v1:0` (default) |
| `GOOGLE_PUBSUB_TOPIC` | Yes | Pub/Sub topic path | `projects/*/topics/*` |
| `TOKEN_ENCRYPTION_KEY` | Yes | AES-256 key — MUST be exactly 32 ASCII chars | `openssl rand -base64 32 \| head -c 32` |
| `CRON_SECRET` | Yes | Bearer token for cron routes | `openssl rand -hex 32` |
| `GMAIL_SMTP_USER` | Yes | Gmail address for sending invites | `yourteam@gmail.com` |
| `GMAIL_SMTP_APP_PASSWORD` | Yes | Gmail app-specific password | From Google account settings |
| `NEXT_PUBLIC_APP_URL` | Yes | Application URL (same as NEXTAUTH_URL) | `https://yourapp.vercel.app` |
| `APP_NAME` | No | Display name | `AI Email Agent` |
| `ORG_DOMAIN` | No | Restrict login to this domain | `yourcompany.com` |
| `SLA_GREEN_MINUTES` | No | SLA green threshold (minutes) | `120` (2 hours) |
| `SLA_YELLOW_MINUTES` | No | SLA yellow threshold (minutes) | `480` (8 hours) |
| `SLA_RED_MINUTES` | No | SLA red / overdue threshold (minutes) | `1440` (24 hours) |

**Critical notes:**
- `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS — only use it in server-side API routes, never in client code or `NEXT_PUBLIC_*` variables
- `TOKEN_ENCRYPTION_KEY` must be exactly 32 ASCII characters for AES-256-CBC — use `openssl rand -base64 32 | head -c 32`
- `CRON_SECRET` must be sent as `Authorization: Bearer <secret>` header on all cron route calls
- Gmail SMTP uses an app-specific password, not the account password

---

## 6. Database Schema

**Database:** Supabase (PostgreSQL) with Row-Level Security (RLS) enabled on all tables.

### Table: `users`
Core user accounts linked to Google OAuth.
```
id          uuid   PRIMARY KEY
email       text   UNIQUE NOT NULL
name        text
plan        text   ('free' | 'pro' | 'enterprise')
created_at  timestamptz
```

### Table: `connected_accounts`
Stores encrypted Gmail OAuth tokens per user.
```
id               uuid   PRIMARY KEY
user_id          uuid   FK → users.id
provider         text   ('gmail' | 'outlook')
email            text   (Gmail address used)
access_token     text   AES-256-CBC encrypted
refresh_token    text   AES-256-CBC encrypted
watch_expiry     timestamptz  (7-day Gmail watch TTL)
last_history_id  text   (Gmail History API cursor — advance before processing)
status           text   ('active' | 'inactive' | 'error')
created_at       timestamptz
```

**Critical:** `last_history_id` is the cursor for the Gmail History API. It must be:
1. Stored on `/api/gmail/setup` with the initial `historyId`
2. Passed as `startHistoryId` to `fetchNewMessages()`
3. Updated to `notification.historyId` BEFORE processing (prevents duplicate processing)

### Table: `team_members`
Team roster — non-OAuth users who may or may not have connected their Gmail yet.
```
id           uuid   PRIMARY KEY
email        text   UNIQUE NOT NULL
name         text   NOT NULL
role         text   ('delivery_lead' | 'senior_ba' | 'senior_mis' | 'senior_developer' | 'ba' | 'mis' | 'developer')
avatar_url   text
is_active    boolean  DEFAULT true
watch_expiry timestamptz  (Gmail watch expiry — used by cron renew)
supabase_uid uuid   FK → users.id (nullable — set when member first logs in)
created_at   timestamptz
```

### Table: `team_member_reports`
Manager → subordinate relationships. Used to build org chart.
```
id           uuid   PRIMARY KEY
member_id    uuid   FK → team_members.id
manager_id   uuid   FK → team_members.id
assigned_at  timestamptz
```

### Table: `member_gmail_tokens`
Per-member Gmail tokens for multi-account reply support.
```
member_id     uuid   PRIMARY KEY  FK → team_members.id
access_token  text   AES-256 encrypted
refresh_token text   AES-256 encrypted
expires_at    timestamptz
updated_at    timestamptz
```

### Table: `email_threads`
One row per Gmail thread. Core entity of the app.
```
id                    uuid   PRIMARY KEY
user_id               uuid   FK → users.id
owner_member_id       uuid   FK → team_members.id (nullable — whose inbox this came from)
thread_id             text   (Gmail threadId — used for deduplication, UNIQUE per user_id)
subject               text
from_email            text
received_at           timestamptz
summary               text   (AI-generated 2–3 sentence summary)
email_link            text   (https://mail.google.com/mail/u/0/#inbox/<thread_id>)
reply_status          text   ('replied' | 'pending' | 'overdue' | 'no_reply_needed')
replied_at            timestamptz
response_minutes      int    (received_at → first reply, in minutes)
pii_was_masked        boolean
pii_types_found       text[] (array of detected PII type names)
message_count         int    (total messages in thread)
reply_count           int    (outbound messages count)
first_replied_at      timestamptz
first_response_minutes int   (thread received → first outbound reply)
last_replied_at       timestamptz
last_inbound_at       timestamptz
last_outbound_at      timestamptz
awaiting_reply_since  timestamptz (set when inbound arrives after outbound — waiting for reply)
is_resolved           boolean
processed_at          timestamptz
created_at            timestamptz
```

### Table: `email_thread_messages`
Individual messages within a thread. Tracks full timeline.
```
id               uuid   PRIMARY KEY
thread_id        uuid   FK → email_threads.id
owner_member_id  uuid   FK → team_members.id (nullable)
gmail_message_id text   (Gmail messageId — UNIQUE for deduplication)
direction        text   ('inbound' | 'outbound')
from_email       text
from_name        text
subject          text
snippet          text   (first ~200 chars of body)
sent_at          timestamptz
response_minutes int    (time from preceding inbound to this outbound, in minutes)
source           text   ('gmail' | 'app' — 'app' means sent via this dashboard)
created_at       timestamptz
```

### Table: `tasks`
Action items extracted from emails by AI.
```
id              uuid   PRIMARY KEY
thread_id       uuid   FK → email_threads.id (nullable — tasks can be standalone)
user_id         uuid   FK → users.id
task            text   (action description)
status          text   ('pending' | 'in_progress' | 'completed' | 'ignored')
priority        text   ('high' | 'medium' | 'low')
assigned_to     text   (name or email — free text from AI)
due_date        date
follow_up_sent  boolean DEFAULT false
created_at      timestamptz
updated_at      timestamptz
```

### Table: `email_replies`
Records of replies sent via the dashboard.
```
id               uuid   PRIMARY KEY
thread_id        uuid   FK → email_threads.id
sent_by_member   uuid   FK → team_members.id
to_email         text
subject          text
body             text
gmail_message_id text   (returned by Gmail after send)
created_at       timestamptz
```

### Table: `ai_logs`
Logs every AI invocation for audit and token tracking.
```
id              uuid   PRIMARY KEY
thread_id       uuid   FK → email_threads.id (nullable)
user_id         uuid   FK → users.id (nullable)
prompt          text
response        text   (JSON stringified AI output)
model_used      text   (e.g. 'amazon.nova-lite-v1:0')
tokens_used     int
pii_items_found int
created_at      timestamptz
```

### Table: `agent_conversations`
AI agent chat sessions per member.
```
id         uuid   PRIMARY KEY
member_id  uuid   FK → team_members.id
title      text   (auto-generated from first message)
created_at timestamptz
updated_at timestamptz
```

### Table: `agent_messages`
Individual messages in AI agent conversations.
```
id               uuid   PRIMARY KEY
conversation_id  uuid   FK → agent_conversations.id
role             text   ('user' | 'assistant')
content          text
threads_fetched  int
threads_analyzed int
action_items     json   (ActionItem[])
timeline         json   (TimelineEvent[])
thread_ids       text[] (Gmail thread IDs referenced)
tokens_used      int
created_at       timestamptz
```

### View: `member_response_stats`
Materialized view for per-member email response performance.
```
id, name, email, role,
total_emails, replied_count, pending_count, overdue_count,
emails_today, avg_response_minutes, fastest_minutes, slowest_minutes,
on_time_pct (%), total_replies, total_replies_sent,
app_reply_count, gmail_reply_count, avg_followup_minutes, awaiting_reply_count
```

### View: `stream_stats`
Aggregated stats per role stream for monitoring.
```
stream (role name), member_count, emails_today, overdue_count, avg_response_minutes
```

---

## 7. Authentication & Authorization

**Library:** NextAuth.js v4

**File:** `app/api/auth/[...nextauth]/route.ts`

### OAuth Flow

1. User visits `/login` → clicks "Continue with Google"
2. Google OAuth consent screen shows with scopes:
   - `openid`, `email`, `profile`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.modify` (needed for watch)
3. NextAuth `signIn` callback executes:
   - Validates `account.provider === 'google'`
   - If `ORG_DOMAIN` env set: validates email domain matches
   - Checks user exists in `team_members` table with `is_active = true`
   - If not in team_members → rejects login (returns false)
   - Upserts row in `users` table
   - Upserts `connected_accounts` with AES-256 encrypted tokens
   - Upserts `member_gmail_tokens` for reply feature
4. NextAuth `jwt` callback adds to token:
   - `accessToken`, `refreshToken` (Google OAuth tokens)
   - `role` (from `team_members.role`)
   - `memberId` (from `team_members.id`)
   - `memberName` (from `team_members.name`)
5. NextAuth `session` callback exposes role, memberId, memberName to `session.user`
6. Dashboard `layout.tsx` calls `getServerSession()` → redirects to `/login` if no session

### Server-Side Auth Pattern (every protected API route)

```typescript
// Pattern used in all API routes
import { getMemberFromSession } from '@/lib/auth'

export async function GET(req: Request) {
  const member = await getMemberFromSession()
  if (!member) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  // member.id, member.email, member.role, member.name, member.is_active
}
```

`getMemberFromSession()` in `lib/auth.ts`:
1. Calls `getServerSession(authOptions)`
2. Queries `team_members` by email + `is_active = true`
3. Returns `AuthenticatedMember | null`

`getAuthenticatedUser()` — used for user-level access (returns `users` row):
1. Calls `getServerSession(authOptions)`
2. Queries `users` by email
3. Returns `{ id, email, name, plan } | null`

### Types

```typescript
// types/next-auth.d.ts — augmented NextAuth session
interface Session {
  user: {
    id: string
    email: string
    name: string
    image?: string
    role: TeamRole
    memberId: string
    memberName: string
    accessToken: string
    refreshToken: string
  }
}

// lib/auth.ts
interface AuthenticatedMember {
  id: string
  email: string
  name: string
  role: TeamRole
  is_active: boolean
}
```

---

## 8. Role System & Visibility Rules

**File:** `lib/roles.ts`

### Role Definitions

```typescript
type TeamRole =
  | 'delivery_lead'     // Top-level manager — sees everything
  | 'senior_ba'         // Senior Business Analyst
  | 'senior_mis'        // Senior MIS Executive
  | 'senior_developer'  // Senior Developer
  | 'ba'                // Business Analyst
  | 'mis'               // MIS Executive
  | 'developer'         // Developer
```

### Role Groups (for UI display)

| Group | Roles |
|-------|-------|
| Leadership | `delivery_lead` |
| BA Stream | `senior_ba`, `ba` |
| MIS Stream | `senior_mis`, `mis` |
| Dev Stream | `senior_developer`, `developer` |

### Visibility Map (who can see whose emails)

```typescript
VISIBILITY_MAP = {
  delivery_lead:    ['delivery_lead','senior_ba','senior_mis','senior_developer','ba','mis','developer'],
  senior_ba:        ['senior_ba', 'ba'],
  senior_mis:       ['senior_mis', 'mis'],
  senior_developer: ['senior_developer', 'developer'],
  ba:               ['ba'],
  mis:              ['mis'],
  developer:        ['developer'],
}
```

Same map used for `REPLY_MAP` — you can only reply to threads you can view.

### Helper Functions

```typescript
canView(viewer: TeamRole, owner: TeamRole): boolean
  // Returns true if viewer's visibility map includes owner's role

canReply(replier: TeamRole, owner: TeamRole): boolean
  // Same as canView — reply permission = view permission

hasTeam(role: TeamRole): boolean
  // Returns true for delivery_lead, senior_ba, senior_mis, senior_developer

isManagerRole(role: TeamRole): boolean
  // Returns true for MANAGER_ROLES = ['delivery_lead','senior_ba','senior_mis','senior_developer']

getNavItems(role: TeamRole): NavItem[]
  // Returns sidebar navigation items based on role:
  // delivery_lead    → Agent, Dashboard, Tasks, Team, Monitor, Manage Users, Settings
  // senior_ba/dev    → Agent, Dashboard, Tasks, Team, Manage Users, Settings
  // ba/developer     → Agent, Dashboard, Tasks, Settings
  // senior_mis/mis   → Agent, Dashboard, Tasks, Team, Manage Users, Settings (if hasTeam)
```

### Enforcement Points

| Route | Enforcement |
|-------|-------------|
| `GET /api/threads` | Filters by `owner_member_id` using `VISIBILITY_MAP` |
| `GET /api/threads/[id]` | `canView(member.role, thread.owner.role)` check → 403 |
| `GET /api/threads/[id]/timeline` | Same `canView()` check → 403 |
| `POST /api/ai/draft` | `canView()` check before generating draft |
| `POST /api/gmail/reply` | `canReply()` check before sending |
| `GET /api/users` | delivery_lead sees all; others see only their stream |
| `GET /api/monitor/stats` | delivery_lead only → 403 otherwise |
| `GET /api/monitor/overdue` | delivery_lead only → 403 otherwise |

---

## 9. Email Processing Pipeline

### Path A — Manual Sync

**Endpoint:** `POST /api/gmail/sync`

```
1. getMemberFromSession() → member
2. Load Gmail tokens from connected_accounts (decrypt)
3. gmail.users.messages.list({ labelIds:['INBOX'], maxResults:20 })
4. For each message:
   a. Extract threadId
   b. Check if thread_id exists in email_threads (by user_id + thread_id)
   c. If EXISTS → skip (already processed)
   d. If NEW:
      - fetchThread(threadId, accessToken) → { threadId, subject, fromEmail, fullText, receivedAt, emailLink, messages }
      - Pre-filter: shouldSkipAIAnalysis(fromEmail, subject, body[0:500])
        → If skip: store with reply_status='no_reply_needed', summary='Automated — no action needed'
      - analyzeEmailThread(fullText, subject) → EmailAnalysisResult
      - INSERT email_threads
      - INSERT ai_logs
      - If requiresAction && tasks.length > 0: INSERT tasks
      - processThreadMessages(threadId, email, messages, memberId)
      - await sleep(1000ms) between AI calls (rate limiting)
5. Return { ok: true, processed: n, skipped: m }
```

### Path B — Real-Time Webhook (Production)

**Setup:** `POST /api/gmail/setup`

```
1. getMemberFromSession() → member
2. Load Gmail tokens
3. gmail.users.watch({ topicName: GOOGLE_PUBSUB_TOPIC, labelIds: ['INBOX'] })
4. Store in connected_accounts: watch_expiry, last_history_id
5. Store in team_members: watch_expiry
```

**Webhook handler:** `POST /api/gmail/webhook`

```
1. Respond 200 immediately (fast-ACK — Google Pub/Sub needs fast response)
2. Async: processWebhookNotification(notification)
   a. decodePubSubMessage(body): base64 decode → { emailAddress, historyId }
   b. Lookup connected_accounts by email
   c. Lookup team_members by email
   d. startHistoryId = account.last_history_id ?? notification.historyId
   e. UPDATE connected_accounts SET last_history_id = notification.historyId (advance cursor FIRST)
   f. fetchNewMessages(accessToken, startHistoryId) → threadIds[]
   g. For each threadId:
      - Check if exists in email_threads
      - fetchThread(threadId, accessToken)
      - If EXISTS: processThreadMessages() (update timeline for new reply)
      - If NEW:
        * Pre-filter check
        * Rate limit check (20 AI calls/member/hour, in-memory map)
        * analyzeEmailThread() via Bedrock
        * INSERT email_threads + ai_logs + tasks
        * processThreadMessages()
```

**Why fast-ACK matters:** Google Pub/Sub retries if it doesn't get a 200 within ~30 seconds. Heavy processing (Gmail API + Bedrock) takes too long. The pattern is: ACK immediately, process asynchronously.

### Thread Message Processing

**File:** `lib/gmail/message-processor.ts` — `processThreadMessages()`

For each Gmail message in the thread:
1. Extract `gmail_message_id`, `direction` (inbound/outbound based on fromEmail vs teamEmail), `from_email`, `from_name`, `snippet`, `sent_at`
2. Deduplicate: skip if `gmail_message_id` already exists in `email_thread_messages`
3. Compute `response_minutes`: if outbound message follows an inbound, calculate diff in minutes
4. INSERT into `email_thread_messages`
5. Update `email_threads` aggregate fields: `message_count`, `reply_count`, `last_inbound_at`, `last_outbound_at`, `first_replied_at`, `first_response_minutes`, `awaiting_reply_since`

---

## 10. AI Analysis Pipeline

**File:** `lib/ai/analyze.ts`

### Model

- **Provider:** AWS Bedrock
- **Model:** Amazon Nova Lite v1 (`amazon.nova-lite-v1:0`)
- **SDK:** `@aws-sdk/client-bedrock-runtime` → `InvokeModelCommand`
- **Format:** Converse-style `messages` + `system` + `inferenceConfig`
- **Region:** `ap-south-1` (default) via `AWS_REGION` env var

### Email Analysis — `analyzeEmailThread(threadContent, subject)`

```
Input:  raw email thread text + subject
Output: EmailAnalysisResult

Steps:
1. cleanEmailForAI(text):
   - If > 3000 chars: split on email separators, keep first message + last 2 messages
   - Truncate to 3000 chars max → "[truncated]"

2. maskPII(cleanedText):
   - Run all PII_PATTERNS regexes
   - Replace matches with [MASKED_*] placeholders
   - Return MaskResult { masked, detectedTypes, itemsRemoved, wasMasked }

3. buildEmailAnalysisPrompt(subject, maskedText) → userPrompt

4. invokeNova(systemPrompt, userPrompt, maxTokens=500, temperature=0.1):
   - Build JSON body for Bedrock
   - Send InvokeModelCommand
   - Parse response.output.message.content[0].text
   - Return { text, inputTokens, outputTokens }

5. callBedrockWithBackoff(fn, retries=3):
   - Retries on ThrottlingException / ServiceUnavailableException
   - Backoff: 2s, 4s, 6s

6. Parse JSON response (strip ```json fences first):
   {
     "summary": "2-3 sentence overview",
     "requires_action": true|false,
     "priority": "high"|"medium"|"low",
     "tasks": [
       { "task": "action description", "priority": "high", "due_date": "YYYY-MM-DD"|null }
     ]
   }

7. Return EmailAnalysisResult:
   { summary, requiresAction, priority, tasks, tokensUsed, piiItemsFound }
```

**Fallback on parse failure:** Returns `{ summary: subject, requiresAction: true, priority: 'medium', tasks: [] }`

### Follow-Up Draft — `generateFollowUpDraft(threadContent, subject, instructions?)`

Same PII masking + Bedrock invocation, but:
- `maxTokens = 800`, `temperature = 0.4` (more creative)
- Uses `buildFollowUpDraftPrompt(subject, maskedText, instructions)`
- Returns `{ subject: "Re: ...", body: "HTML email body", tokensUsed }`
- Fallback: `{ subject: "Re: <subject>", body: "Thank you for your email..." }`

### Quick Classifier — `quickClassifyEmail(subject, bodySnippet)`

- `maxTokens = 50`, `temperature = 0` (deterministic)
- Returns `{ isAutomated: boolean, needsReply: boolean }`
- Used for lightweight pre-screening before full analysis

### AI Prompts

**File:** `lib/ai/prompts.ts`

- `buildEmailAnalysisPrompt(subject, maskedContent)` — instructs Nova to extract summary, action flag, priority, and tasks as JSON
- `buildFollowUpDraftPrompt(subject, maskedContent, instructions?)` — instructs Nova to write a professional follow-up email as JSON `{ subject, body }`

### Rate Limiting (In-Memory)

Stored in `lib/gmail/webhook.ts`:
```typescript
const memberAICallCount = new Map<string, { count: number; resetAt: number }>()
// 20 AI calls per member per hour
// Reset at: now + 3_600_000ms
```

---

## 11. PII Detection & Masking

**Files:** `lib/pii/masker.ts`, `lib/pii/patterns.ts`

### `maskPII(raw: string): MaskResult`

Runs each pattern in `PII_PATTERNS` against the text and replaces matches.

### Detected PII Types (from `patterns.ts`)

| Type | Pattern Description | Replacement |
|------|--------------------|-----------||
| `SK_KEY` | OpenAI/Anthropic API keys (`sk-proj-*`, `sk-ant-*`) | `[MASKED_SK_KEY]` |
| `API_KEY` | Generic API keys (`api_key=`, `apikey=`) | `[MASKED_API_KEY]` |
| `ACCESS_TOKEN` | OAuth / Bearer tokens | `[MASKED_ACCESS_TOKEN]` |
| `PASSWORD` | Password fields (`password=`, `pwd=`) | `[MASKED_PASSWORD]` |
| `AWS_KEY` | AWS access key IDs (`AKIA*`) | `[MASKED_AWS_KEY]` |
| `PRIVATE_KEY` | PEM private keys | `[MASKED_PRIVATE_KEY]` |
| `CONN_STRING` | Database connection strings | `[MASKED_CONN_STRING]` |
| `PHONE_IN` | Indian mobile numbers (10-digit starting 6-9) | `[MASKED_PHONE]` |
| `AADHAAR` | Indian Aadhaar numbers (12 digits) | `[MASKED_AADHAAR]` |
| `PAN` | Indian PAN card numbers (`[A-Z]{5}[0-9]{4}[A-Z]`) | `[MASKED_PAN]` |
| `CARD` | Credit/debit card numbers (13-16 digits, Luhn) | `[MASKED_CARD]` |

### Result Type

```typescript
interface MaskResult {
  masked: string         // Text with PII replaced
  detectedTypes: string[] // Array of type names found
  itemsRemoved: number   // Total count of replacements made
  wasMasked: boolean     // true if any PII was found
}
```

Result stored in `email_threads.pii_was_masked` and `email_threads.pii_types_found`.

---

## 12. Token Encryption

**File:** `lib/crypto.ts`

All Gmail OAuth tokens are encrypted at rest in Supabase.

```typescript
encryptToken(plain: string): string
// AES-256-CBC encryption
// Random 16-byte IV per token
// Output format: "ivHex:ciphertextHex"
// Requires TOKEN_ENCRYPTION_KEY (exactly 32 ASCII chars)

decryptToken(encrypted: string): string
// Split on ':', decode IV + ciphertext, decrypt

safeDecrypt(token: string): string
// Smart detection: if token looks encrypted (contains ':' but not 'ya29.' or '1/')
// → decrypt; otherwise return as-is
// Handles legacy plaintext tokens gracefully
```

**Token storage locations:**
- `connected_accounts.access_token` / `.refresh_token`
- `member_gmail_tokens.access_token` / `.refresh_token`

---

## 13. Gmail Integration

**Files:** `lib/gmail/`

### `client.ts` — Gmail API Client

```typescript
getGmailClient(accessToken, refreshToken): google.gmail_v1.Gmail
// Creates OAuth2 client with stored tokens
// Handles automatic token refresh via googleapis

refreshAccessToken(refreshToken): Promise<string>
// Calls Google OAuth2 endpoint to get new access token
// Returns new access_token
```

### `thread.ts` — Thread Fetching

```typescript
fetchThread(threadId, accessToken, refreshToken?):
  Promise<{
    threadId: string
    subject: string
    fromEmail: string
    fullText: string     // Concatenated body of all messages
    receivedAt: string   // ISO timestamp of first message
    emailLink: string    // Direct Gmail URL
    messages: GmailMessage[]
  }>

fetchNewMessages(accessToken, startHistoryId, refreshToken?):
  Promise<string[]>  // Array of new threadIds since startHistoryId
// Uses gmail.users.history.list() — the incremental sync API
```

### `message-processor.ts` — Timeline Builder

```typescript
processThreadMessages(
  dbThreadId: string,
  ownerEmail: string,
  messages: GmailMessage[],
  ownerMemberId: string
): Promise<void>
// Inserts messages into email_thread_messages (deduped by gmail_message_id)
// Recomputes thread aggregate fields in email_threads
```

### `reply.ts` — Sending Replies

```typescript
sendGmailReply(params: SendReplyParams): Promise<SendReplyResult>
// Builds RFC 2822 email with headers:
//   To, Subject (prepends "Re: " if needed), In-Reply-To, References, Content-Type
// Base64url encodes and sends via gmail.users.messages.send()
// threadId preserved via requestBody.threadId

getLastMessageId(accessToken, refreshToken, gmailThreadId): Promise<string | null>
// Fetches thread with METADATA format
// Returns last message's Message-ID header (for In-Reply-To threading)
```

### `webhook.ts` — Pub/Sub Processing

See Section 9 (Email Processing Pipeline) for full flow.

```typescript
decodePubSubMessage(body): PubSubMessage | null
// body.message.data → base64 decode → JSON parse → { emailAddress, historyId }

processWebhookNotification(notification: PubSubMessage): Promise<void>
// Full async processing: lookup account, fetch history, analyze new threads
```

---

## 14. API Routes Reference

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/auth/[...nextauth]` | NextAuth handler (OAuth, sessions, callbacks) |

### Gmail

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/gmail/setup` | Member session | Register Gmail watch (7-day TTL); stores watch_expiry + last_history_id |
| POST | `/api/gmail/sync` | Member session | Manual sync: fetches 20 recent INBOX threads, analyzes new ones |
| POST | `/api/gmail/webhook` | None (Pub/Sub push) | Receives Pub/Sub push notification; fast-ACKs; processes async |
| POST | `/api/gmail/search` | Member session | Search Gmail by query string; returns matching thread IDs + snippets |
| POST | `/api/gmail/reply` | Member session | Send reply via Gmail API; records in email_replies; updates thread status |

**Webhook security:** Google Pub/Sub sends to public URL. Validate by checking `emailAddress` exists in `connected_accounts`.

### AI

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/ai/analyze` | Member session | Analyze thread content OR generate follow-up draft (based on request body discriminator) |
| POST | `/api/ai/draft` | Member session | Generate follow-up draft; checks `canView()` for the thread owner; rate-limited 10/min |

### Tasks

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/tasks` | Member session | List tasks with filters (status, priority, limit, offset) |
| POST | `/api/tasks` | Member session | Create task manually (not from email) |
| PATCH | `/api/tasks/[id]` | Member session | Update task fields (status, priority, due_date, assigned_to) |
| DELETE | `/api/tasks/[id]` | Member session | Delete task by ID |

### Threads

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/threads` | Member session | List threads (paginated); filtered by `VISIBILITY_MAP[member.role]`; sorted by received_at DESC |
| GET | `/api/threads/[id]` | Member session | Get thread detail + messages; enforces `canView()` |
| GET | `/api/threads/[id]/timeline` | Member session | Get message timeline for thread; enforces `canView()` |

### Users & Team

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users` | Member session | List team members (delivery_lead sees all; others see their stream) |
| POST | `/api/users` | Manager role | Create new team member; sends invite email via SMTP |
| GET | `/api/users/[id]` | Member session | Get member details |
| PATCH | `/api/users/[id]` | Manager or delivery_lead | Update member fields (role, name, is_active, etc.) |
| POST | `/api/users/[id]/invite` | Manager or delivery_lead | Resend invite email |
| GET | `/api/team/assignments` | Manager role | Get manager→member relationships |
| POST | `/api/team/assignments` | Manager role | Assign member to manager |

### Personal Stats

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/me/stats` | Member session | Personal response time metrics (avg, fastest, slowest, on_time_pct) |
| GET | `/api/me/pending` | Member session | List pending / awaiting-reply emails for current member |

### Monitoring (delivery_lead only)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/monitor/stats` | delivery_lead | Full team response stats (queries `member_response_stats` view) |
| GET | `/api/monitor/overdue` | delivery_lead | Overdue threads across all team members |

### AI Agent

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/agent/query` | Member session | Ask agent a question; agent searches Gmail + analyzes threads |
| GET | `/api/agent/conversations` | Member session | List conversation history |
| POST | `/api/agent/conversations` | Member session | Create new conversation |
| GET | `/api/agent/conversations/[id]` | Member session | Get conversation + all messages |

### Cron Jobs (Bearer token auth)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/cron/daily` | `CRON_SECRET` | Combined: marks overdue threads + renews Gmail watches |
| POST | `/api/cron/mark-overdue` | `CRON_SECRET` | Marks pending threads as overdue based on SLA thresholds |
| POST | `/api/cron/renew-watches` | `CRON_SECRET` | Renews Gmail watches expiring within 2 days |

**Cron auth pattern:**
```typescript
const auth = req.headers.get('authorization')
if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
  return Response.json({ error: 'Forbidden' }, { status: 403 })
}
```

---

## 15. Library Files

### `lib/auth.ts`

```typescript
getServiceSupabase()
// Returns Supabase client with SERVICE_ROLE_KEY (bypasses RLS)
// Use only in server-side API routes

getAuthenticatedUser(): Promise<UserRow | null>
// Returns users row for current session user

getMemberFromSession(): Promise<AuthenticatedMember | null>
// Returns team_members row for current session user
// Only returns active members (is_active = true)
```

### `lib/roles.ts`

All role types, display labels, colors, VISIBILITY_MAP, and helper functions. See Section 8.

### `lib/utils.ts`

```typescript
cn(...inputs): string
// Combines clsx + tailwind-merge for conditional class names

formatDate(date: string | Date): string
// "Jan 15, 2025" format using date-fns

formatDueDate(date: string | null): string
// "Due Jan 15" or "Overdue" if past

formatRelativeDate(date: string | Date): string
// "2 hours ago", "yesterday", etc.
```

### `lib/supabase/client.ts`

```typescript
// Browser-side client (anon key, RLS enforced)
export const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY)
```

### `lib/supabase/server.ts`

```typescript
// SSR client (anon key via cookie-based auth)
export async function createServerClient(): Promise<SupabaseClient>
// Used in Server Components and Route Handlers for cookie-based auth
```

### `lib/supabase/types.ts`

Generated TypeScript types for all database tables. Import `Database` type and use `Database['public']['Tables']['table_name']['Row']` pattern.

### `lib/tasks/auto-update.ts`

```typescript
autoUpdateThreadTasks(threadId: string, newStatus: TaskStatus): Promise<void>
// Called after a reply is sent
// Updates all tasks linked to the thread from 'pending' → 'in_progress'
// Does NOT auto-complete — that requires explicit user action
```

---

## 16. Frontend Architecture

### Page Structure

```
app/layout.tsx (Root)
├── <html lang="en" suppressHydrationWarning>
│   ├── <Providers>  ← ThemeProvider + SessionProvider + Tooltip
│   └── {children}

app/(dashboard)/layout.tsx
├── DashboardShell
│   ├── <Sidebar>   ← always dark background; role-based nav
│   └── <main>
│       ├── <Header>  ← theme toggle, user avatar, logout
│       └── {children}  ← page content
```

### Dashboard Page (`app/(dashboard)/page.tsx`)

State: tasks array, loading, dialogs, selected task/thread

Data fetching:
1. `useSession()` → get member info
2. `fetch('/api/me/stats')` → personal stats for DailyDigest
3. `fetch('/api/threads?memberId=...')` → thread + task list
4. Supabase Realtime subscription on `tasks` table → auto-refetch on change

Components rendered:
- `<DailyDigest tasks={tasks} />` — 4 stat cards computed client-side
- `<TaskTable tasks={tasks} onRowClick={...} />` — sortable, expandable rows
- `<ThreadDetailPanel>` / `<TaskDetailPanel>` — side panels opened on row click
- `<ReplyComposer>` — dialog for drafting + sending replies

### Key Components

**`DailyDigest.tsx`**
- Receives full task array
- Computes counts: total, pending, high-priority (non-completed), completed today
- Renders 4 animated stat cards

**`TaskTable.tsx`**
- Uses `@tanstack/react-table` for sorting
- Expandable row: click row → expand `<TaskCard>` below
- Status dropdown: inline PATCH to `/api/tasks/[id]`
- Pagination: limit=50, offset param

**`ReplyComposer.tsx`**
- Tiptap rich text editor
- "Draft with AI" button → POST `/api/ai/draft` → populates editor
- "Send" button → POST `/api/gmail/reply` → sends via Gmail API
- Rate limited: 5 replies/member/minute (enforced server-side)

**`Sidebar.tsx`**
- Always dark background (`bg-gray-900`)
- Nav items generated by `getNavItems(role)` from `lib/roles.ts`
- Active item highlighted

**`Header.tsx`**
- Theme toggle (sun/moon icons) via `next-themes`
- User avatar (Google photo URL from session)
- Dropdown: Profile, Settings link, Sign out

### State Management Approach

- **No Redux/Zustand** — all state is local React state or server state
- Server components for initial data where possible
- `useSession()` hook for auth state
- Custom hooks for data fetching (useEffect + fetch)
- Supabase Realtime for live updates

---

## 17. Real-Time Updates

**Technology:** Supabase Realtime (`postgres_changes` channel)

**Implementation in dashboard page:**

```typescript
useEffect(() => {
  const channel = supabase
    .channel('tasks-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tasks' },
      (payload) => {
        // Refetch tasks when any INSERT/UPDATE/DELETE occurs
        fetchTasks()
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)  // Cleanup on unmount
  }
}, [])
```

When a new email is processed by the webhook and tasks are inserted, every connected browser automatically refreshes — no polling needed.

---

## 18. Cron Jobs

All cron routes require `Authorization: Bearer <CRON_SECRET>` header. Schedule with Vercel Cron or external service (GitHub Actions, AWS EventBridge, etc.).

### `/api/cron/mark-overdue` (recommended: every hour)

```
1. Find all email_threads where:
   - reply_status = 'pending'
   - received_at < NOW() - SLA_RED_MINUTES (default 1440 min = 24h)
2. UPDATE reply_status = 'overdue'
3. Return { updated: count }
```

### `/api/cron/renew-watches` (recommended: every 6 hours)

```
1. Find all team_members where watch_expiry < NOW() + 2 days
2. For each:
   a. Load Gmail tokens (member_gmail_tokens → fallback to connected_accounts)
   b. Decrypt tokens
   c. gmail.users.watch({ topicName, labelIds: ['INBOX'] })
   d. UPDATE team_members.watch_expiry = new expiry
   e. UPDATE connected_accounts.last_history_id = new historyId
3. Return { renewed: count }
```

### `/api/cron/daily` (recommended: once per day)

Calls both mark-overdue and renew-watches in sequence.

---

## 19. Email Invite System

**Files:** `lib/email/sender.ts`, `lib/email/invite-template.ts`

When a new team member is created via `POST /api/users`:

```typescript
sendInviteEmail({
  toEmail: member.email,
  toName:  member.name,
  role:    member.role,
  inviterName: currentMember.name,
  loginUrl: process.env.NEXT_PUBLIC_APP_URL + '/login',
}): Promise<void>
```

Implementation:
1. Creates Nodemailer transporter with Gmail SMTP
2. Builds HTML email via `buildInviteEmailHtml()` template
3. Sends via `transporter.sendMail()`
4. In development (no SMTP config): logs email to console instead of sending

**SMTP config:**
```
host: smtp.gmail.com
port: 587
auth: { user: GMAIL_SMTP_USER, pass: GMAIL_SMTP_APP_PASSWORD }
```

---

## 20. SLA Monitoring

**SLA thresholds** (configurable via env vars):

| Threshold | Default | Meaning |
|-----------|---------|---------|
| `SLA_GREEN_MINUTES` | 120 | ≤ 2 hours → green |
| `SLA_YELLOW_MINUTES` | 480 | ≤ 8 hours → yellow |
| `SLA_RED_MINUTES` | 1440 | > 24 hours → overdue |

**Monitor page** (`/monitor`) — delivery_lead only:

- Fetches `GET /api/monitor/stats` → queries `member_response_stats` view
- Shows per-member: emails today, avg response time, on-time %, overdue count
- Fetches `GET /api/monitor/overdue` → lists overdue threads across all members
- Color-coded response time badges

**Thread SLA tracking fields:**
- `email_threads.reply_status`: `pending → replied | overdue | no_reply_needed`
- `email_threads.first_response_minutes`: time from `received_at` to first outbound reply
- `email_threads.awaiting_reply_since`: set when last message is inbound (waiting for team reply)

---

## 21. AI Agent Conversation Feature

**Page:** `/agent`
**API:** `POST /api/agent/query`

Allows team members to ask natural-language questions about emails across the team.

### Query Flow

```
User types: "What did Infosys say about Module 2 delivery?"
    ↓
POST /api/agent/query { question, conversationId }
    ↓
1. getMemberFromSession() → verify auth
2. Use Nova AI to extract Gmail search query from question
3. Search Gmail API for all team members visible to current user
   (respects VISIBILITY_MAP)
4. Filter results: skip newsletters, alerts, automated (shouldSkipAIAnalysis)
5. Fetch full thread content for top N results
6. analyzeEmailThread() for each relevant thread
7. Aggregate: action_items, timeline, risks, next_steps
8. Store in agent_messages table
9. Return structured response:
   {
     answer: "Summary of findings...",
     actionItems: [{ task, priority, due_date }],
     timeline: [{ date, event }],
     threadIds: ["...", "..."],
     tokensUsed: 1500
   }
```

### Conversation History

Stored in `agent_conversations` (one per session) + `agent_messages` (user + assistant turns).
- `GET /api/agent/conversations` — list past conversations
- `GET /api/agent/conversations/[id]` — full conversation thread

---

## 22. Security Implementation

### Implemented

1. **HTTPS-only headers** (`next.config.ts`):
   ```
   X-Frame-Options: DENY
   X-Content-Type-Options: nosniff
   Referrer-Policy: strict-origin-when-cross-origin
   Permissions-Policy: camera=(), microphone=(), geolocation=()
   X-XSS-Protection: 1; mode=block
   ```

2. **AES-256-CBC token encryption** — all OAuth tokens encrypted at rest; see Section 12

3. **Row-Level Security** — all Supabase tables have RLS; service role key only used server-side

4. **CSRF protection** — NextAuth.js handles CSRF token validation

5. **Org domain restriction** — `ORG_DOMAIN` env var blocks logins from other domains

6. **PII masking before AI** — no sensitive data sent to external AI model; see Section 11

7. **Rate limiting** (in-memory per-member):
   - AI analysis: 20 calls/member/hour
   - Draft generation: 10 calls/member/minute
   - Reply sending: 5 calls/member/minute

8. **Role-based access control** — every API route enforces visibility rules; see Section 8

9. **Cron route protection** — `CRON_SECRET` bearer token

10. **Token format detection** — `safeDecrypt()` prevents double-decryption of legacy plaintext tokens

### Security Checklist for Production

- [ ] Move secrets out of `.env` files into managed secret store (AWS Secrets Manager, Vercel env vars)
- [ ] Rotate `TOKEN_ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `CRON_SECRET`
- [ ] Verify `SUPABASE_SERVICE_ROLE_KEY` is NOT in any `NEXT_PUBLIC_*` variable
- [ ] Enable Supabase RLS policies for each table
- [ ] Set `ORG_DOMAIN` to restrict sign-ups
- [ ] Add Google Pub/Sub webhook signature verification
- [ ] Implement persistent rate limiting (Redis) instead of in-memory Map

---

## 23. Testing

**Framework:** Vitest

**Test files:**

```
__tests__/
├── pii.test.ts    ← Tests for maskPII() — verifies each PII type is detected and replaced
└── roles.test.ts  ← Tests for canView(), canReply(), hasTeam(), isManagerRole()
```

**Run tests:**
```bash
cd ai-email-agent
npx vitest run
```

**What is tested:**
- PII masking: API keys, passwords, phone numbers, Aadhaar, PAN, credit cards
- Role visibility: each role can only see allowed roles; delivery_lead sees all
- Role helpers: hasTeam, isManagerRole edge cases

**What is NOT tested (manual verification needed):**
- Gmail API integration (requires live OAuth tokens)
- Bedrock AI responses (requires AWS credentials + network)
- Supabase RLS policies (requires Supabase connection)
- Full webhook flow (requires Google Pub/Sub + public URL)

---

## 24. Development & Deployment

### Local Development

```bash
cd ai-email-agent
npm install
cp .env.example .env.local   # Fill in all required vars
npm run dev                   # Start dev server at http://localhost:3000
```

**Local limitations:**
- Pub/Sub webhook requires a public URL (use ngrok: `ngrok http 3000`)
- Gmail SMTP sends real emails — use test account
- AWS Bedrock requires real AWS credentials

### Available Scripts

```bash
npm run dev     # Development server (hot reload)
npm run build   # Production build
npm run start   # Start production server
npm run lint    # ESLint check
```

### Vercel Deployment (Recommended)

1. Push to GitHub
2. Connect repo to Vercel
3. Add all env vars in Vercel dashboard
4. Deploy — Next.js auto-configured
5. Set up Vercel Cron Jobs:
   ```
   /api/cron/daily → runs at 00:00 UTC daily
   /api/cron/renew-watches → runs every 6 hours
   /api/cron/mark-overdue → runs every hour
   ```
6. Configure Google Pub/Sub push subscription to `https://yourapp.vercel.app/api/gmail/webhook`

### Database Setup (Supabase)

1. Create new Supabase project
2. Run migration files from `supabase/` directory in SQL Editor
3. Add missing column if needed:
   ```sql
   ALTER TABLE connected_accounts ADD COLUMN IF NOT EXISTS last_history_id TEXT;
   ```
4. Enable RLS on all tables
5. Create `member_response_stats` and `stream_stats` views

### Path Aliases

TypeScript paths configured in `tsconfig.json`:
```json
{ "@/*": ["./src/*"] }
```

Imports use `@/lib/...`, `@/components/...`, `@/app/...` etc.

---

## 25. Known Issues & Fixes

| Issue | Status | Fix Applied |
|-------|--------|-------------|
| Gmail `historyId` cursor processed wrong → duplicate emails | Fixed | Store `last_history_id` on setup; advance cursor BEFORE processing; use stored cursor as startHistoryId |
| `Date` header parse failure → NaN timestamp | Fixed | Parse with `new Date(headerValue).toISOString()` with fallback |
| React `key` prop warning on fragments | Fixed | Use `<Fragment key={id}>` instead of `<>` in lists |
| `last_history_id` column missing in DB | Run manually | `ALTER TABLE connected_accounts ADD COLUMN IF NOT EXISTS last_history_id TEXT` |
| Bedrock `ThrottlingException` on high volume | Mitigated | `callBedrockWithBackoff()` retries with 2s/4s/6s backoff |
| Supabase Realtime subscription memory leak | Fixed | `supabase.removeChannel(channel)` in useEffect cleanup |
| Double encryption of already-encrypted tokens | Fixed | `safeDecrypt()` detects format before decrypting |
| Pub/Sub delivery timeout (>30s processing) | Fixed | Fast-ACK pattern: return 200 immediately, process async |
| `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS on client | Risk | Only used in `lib/auth.ts` `getServiceSupabase()` — never exposed to browser |
| In-memory rate limiting lost on Vercel cold starts | Known | Use Redis/Upstash for persistent rate limiting in production |

---

## 26. Data Flow Diagrams

### New Email → Dashboard Update

```
Gmail Inbox (external email arrives)
    │
    ▼ (watch notification)
Google Pub/Sub
    │
    ▼ POST /api/gmail/webhook
Next.js Route Handler
    │ return 200 immediately (fast-ACK)
    │
    ▼ (async)
processWebhookNotification()
    ├── Lookup connected_accounts (Supabase)
    ├── Advance last_history_id cursor (Supabase UPDATE)
    ├── fetchNewMessages() (Gmail History API)
    │
    └── For each new thread:
        ├── fetchThread() (Gmail API)
        ├── shouldSkipAIAnalysis() (pre-filter)
        │   └── IF skip: INSERT email_threads (no_reply_needed)
        ├── checkMemberAIRateLimit() (in-memory)
        ├── maskPII() → cleanEmailForAI()
        ├── invokeNova() (AWS Bedrock)
        │   └── InvokeModelCommand → JSON response
        ├── INSERT email_threads (Supabase)
        ├── INSERT ai_logs (Supabase)
        ├── INSERT tasks (Supabase)
        └── processThreadMessages() (Supabase)
                    │
                    ▼ (Supabase Realtime triggers)
            Browser WebSocket notification
                    │
                    ▼
            Dashboard auto-refetches tasks
```

### User Sends Reply

```
User types reply in ReplyComposer
    │
    ▼ POST /api/gmail/reply
Next.js Route Handler
    ├── getMemberFromSession() → member
    ├── Load member_gmail_tokens (Supabase) → decrypt
    ├── canReply(member.role, thread.owner.role) check
    ├── getLastMessageId() (Gmail API) → In-Reply-To header
    ├── sendGmailReply() (Gmail API)
    │   └── Returns { messageId, threadId }
    ├── INSERT email_replies (Supabase)
    ├── INSERT email_thread_messages (direction='outbound', source='app')
    ├── UPDATE email_threads (reply_status='replied', replied_at, response_minutes)
    └── autoUpdateThreadTasks() → UPDATE tasks status='in_progress'
```

### Role-Based Thread List

```
Browser: GET /api/threads
    │
    ▼
getMemberFromSession() → member (role: 'senior_ba')
    │
    ▼
VISIBILITY_MAP['senior_ba'] = ['senior_ba', 'ba']
    │
    ▼
Supabase query:
  SELECT email_threads.* 
  FROM email_threads
  JOIN team_members ON email_threads.owner_member_id = team_members.id
  WHERE team_members.role IN ('senior_ba', 'ba')
  ORDER BY received_at DESC
  LIMIT 50
    │
    ▼
Return threads[]
```

---

*This guide covers 100% of the project's files, data models, APIs, integrations, and behaviors as of the documented state. Update this file whenever significant architectural changes are made.*
