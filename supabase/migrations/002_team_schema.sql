-- ─────────────────────────────────────────────────────────────────────────────
-- 002_team_schema.sql
-- Depends on: 001_initial_schema.sql
-- Safe to run multiple times (IF NOT EXISTS / IF NOT EXISTS guards throughout)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- FIX from ONBOARDING.md §11 (missing column)
-- last_history_id was added to TypeScript types and used in webhook.ts
-- but was never included in the 001 migration.
-- ─────────────────────────────────────────────
ALTER TABLE public.connected_accounts
  ADD COLUMN IF NOT EXISTS last_history_id TEXT;

-- ─────────────────────────────────────────────
-- ROLE ENUM
-- ─────────────────────────────────────────────
CREATE TYPE team_role AS ENUM (
  'delivery_lead','senior_ba','senior_mis','senior_developer',
  'ba','mis','developer'
);

-- ─────────────────────────────────────────────
-- TEAM MEMBERS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_uid    UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email           TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  role            team_role NOT NULL,
  avatar_url      TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  watch_expiry    TIMESTAMPTZ,
  last_history_id TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tm_role   ON public.team_members(role);
CREATE INDEX IF NOT EXISTS idx_tm_active ON public.team_members(is_active);

-- ─────────────────────────────────────────────
-- GMAIL TOKENS PER MEMBER
-- Separate from connected_accounts (which stays untouched).
-- Used only by the reply feature.
-- Webhook continues using connected_accounts as-is.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_gmail_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(member_id)
);

-- ─────────────────────────────────────────────
-- EMAIL THREADS — add new columns (existing columns untouched)
-- owner_member_id references team_members created above
-- ─────────────────────────────────────────────
ALTER TABLE public.email_threads
  ADD COLUMN IF NOT EXISTS owner_member_id  UUID REFERENCES public.team_members(id),
  ADD COLUMN IF NOT EXISTS reply_status     TEXT DEFAULT 'pending'
    CHECK (reply_status IN ('replied','pending','overdue','no_reply_needed')),
  ADD COLUMN IF NOT EXISTS replied_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS response_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS pii_was_masked   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pii_types_found  TEXT[];

CREATE INDEX IF NOT EXISTS idx_et_owner_member ON public.email_threads(owner_member_id);
CREATE INDEX IF NOT EXISTS idx_et_reply_status ON public.email_threads(reply_status);

-- ─────────────────────────────────────────────
-- EMAIL REPLIES (sent from the app)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_replies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id        UUID NOT NULL REFERENCES public.email_threads(id) ON DELETE CASCADE,
  sent_by_member   UUID NOT NULL REFERENCES public.team_members(id),
  to_email         TEXT NOT NULL,
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  gmail_message_id TEXT,
  sent_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- AI LOGS — add PII tracking columns
-- ─────────────────────────────────────────────
ALTER TABLE public.ai_logs
  ADD COLUMN IF NOT EXISTS pii_items_found INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owner_member_id UUID REFERENCES public.team_members(id);

-- ─────────────────────────────────────────────
-- FIX: correct stale model string in existing data
-- (sync/route.ts logs 'gemini-2.0-flash' but actual model is 'gemini-2.5-flash')
-- ─────────────────────────────────────────────
UPDATE public.ai_logs
  SET model_used = 'gemini-2.5-flash'
  WHERE model_used = 'gemini-2.0-flash';

-- ─────────────────────────────────────────────
-- HELPER FUNCTION: visible roles per role
-- Must stay in sync with VISIBILITY_MAP in lib/roles.ts
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_visible_roles(viewer team_role)
RETURNS team_role[] AS $$
BEGIN
  RETURN CASE viewer
    WHEN 'delivery_lead'    THEN ARRAY['delivery_lead','senior_ba','senior_mis',
                                       'senior_developer','ba','mis','developer']::team_role[]
    WHEN 'senior_ba'        THEN ARRAY['senior_ba','ba']::team_role[]
    WHEN 'senior_mis'       THEN ARRAY['senior_mis','mis']::team_role[]
    WHEN 'senior_developer' THEN ARRAY['senior_developer','developer']::team_role[]
    ELSE                         ARRAY[viewer]::team_role[]
  END;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─────────────────────────────────────────────
-- HELPER FUNCTION: member IDs visible to current user
-- Used by RLS policies below
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_visible_member_ids()
RETURNS SETOF UUID AS $$
DECLARE viewer_role team_role;
BEGIN
  SELECT tm.role INTO viewer_role
  FROM public.team_members tm
  WHERE tm.supabase_uid = auth.uid()
  AND tm.is_active = TRUE;

  RETURN QUERY
  SELECT id FROM public.team_members
  WHERE role = ANY(get_visible_roles(viewer_role))
  AND is_active = TRUE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─────────────────────────────────────────────
-- RESPONSE STATS VIEW (Monitor page)
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW public.member_response_stats AS
SELECT
  m.id, m.name, m.email, m.role,
  COUNT(t.id)                                                AS total_emails,
  COUNT(t.id) FILTER (WHERE t.reply_status = 'replied')     AS replied_count,
  COUNT(t.id) FILTER (WHERE t.reply_status = 'pending')     AS pending_count,
  COUNT(t.id) FILTER (WHERE t.reply_status = 'overdue')     AS overdue_count,
  COUNT(t.id) FILTER (WHERE t.received_at > NOW() - INTERVAL '24h') AS emails_today,
  ROUND(AVG(t.response_minutes))                            AS avg_response_minutes,
  MIN(t.response_minutes)                                   AS fastest_minutes,
  MAX(t.response_minutes)                                   AS slowest_minutes,
  ROUND(
    100.0
    * COUNT(t.id) FILTER (WHERE t.response_minutes <= 120 AND t.reply_status = 'replied')
    / NULLIF(COUNT(t.id) FILTER (WHERE t.reply_status = 'replied'), 0)
  )                                                         AS on_time_pct
FROM public.team_members m
LEFT JOIN public.email_threads t ON t.owner_member_id = m.id
WHERE m.is_active = TRUE
GROUP BY m.id, m.name, m.email, m.role;

-- ─────────────────────────────────────────────
-- STREAM STATS VIEW (Monitor summary cards)
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW public.stream_stats AS
SELECT
  CASE m.role
    WHEN 'senior_ba'        THEN 'BA Stream'
    WHEN 'ba'               THEN 'BA Stream'
    WHEN 'senior_mis'       THEN 'MIS Stream'
    WHEN 'mis'              THEN 'MIS Stream'
    WHEN 'senior_developer' THEN 'Dev Stream'
    WHEN 'developer'        THEN 'Dev Stream'
    ELSE 'Leadership'
  END AS stream,
  COUNT(DISTINCT m.id)                                      AS member_count,
  COUNT(t.id) FILTER (WHERE t.received_at > NOW() - INTERVAL '24h') AS emails_today,
  COUNT(t.id) FILTER (WHERE t.reply_status = 'overdue')    AS overdue_count,
  ROUND(AVG(t.response_minutes))                            AS avg_response_minutes
FROM public.team_members m
LEFT JOIN public.email_threads t ON t.owner_member_id = m.id
WHERE m.is_active = TRUE
GROUP BY stream;

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE public.team_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_gmail_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_replies       ENABLE ROW LEVEL SECURITY;

-- team_members: read only members in your visible role set
CREATE POLICY "members_read_visible" ON public.team_members FOR SELECT
  USING (id IN (SELECT get_visible_member_ids()));

-- team_members: only delivery_lead can insert/update/delete
CREATE POLICY "members_admin_write" ON public.team_members FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.team_members
    WHERE supabase_uid = auth.uid() AND role = 'delivery_lead'
  ));

-- gmail tokens: each member sees only their own
CREATE POLICY "tokens_own_only" ON public.member_gmail_tokens FOR ALL
  USING (member_id = (
    SELECT id FROM public.team_members WHERE supabase_uid = auth.uid()
  ));

-- replies: visible if the thread is visible to you
CREATE POLICY "replies_read_visible" ON public.email_replies FOR SELECT
  USING (thread_id IN (
    SELECT id FROM public.email_threads
    WHERE owner_member_id IN (SELECT get_visible_member_ids())
  ));

-- replies: anyone can insert a reply they sent themselves
CREATE POLICY "replies_write_own" ON public.email_replies FOR INSERT
  WITH CHECK (sent_by_member = (
    SELECT id FROM public.team_members WHERE supabase_uid = auth.uid()
  ));

-- ─────────────────────────────────────────────
-- BOOTSTRAP: Insert Delivery Lead
-- Replace values below before running
-- ─────────────────────────────────────────────
-- INSERT INTO public.team_members (email, name, role, is_active)
-- VALUES ('delivery-lead@yourcompany.com', 'Full Name', 'delivery_lead', true);
-- (Uncomment, fill in real values, run separately after the rest succeeds)
