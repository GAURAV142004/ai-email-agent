-- ─────────────────────────────────────────────────────────────────────────────
-- 003_full_thread_tracking.sql  (replaces earlier 003 draft)
-- Every individual message in every thread tracked with direction,
-- response times, and full timeline.
-- Safe to run on existing DB: uses IF NOT EXISTS / OR REPLACE throughout.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- Every individual message in every thread
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_thread_messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id             UUID NOT NULL REFERENCES email_threads(id)
                          ON DELETE CASCADE,
  owner_member_id       UUID REFERENCES team_members(id),
  gmail_message_id      TEXT NOT NULL,
  direction             TEXT NOT NULL
                          CHECK (direction IN ('inbound','outbound')),
  from_email            TEXT,
  from_name             TEXT,
  subject               TEXT,
  snippet               TEXT,          -- first 200 chars of message
  sent_at               TIMESTAMPTZ,
  source                TEXT DEFAULT 'gmail'
                          CHECK (source IN ('gmail','app')),
  -- Response time from previous inbound to this outbound
  -- NULL for inbound messages
  response_minutes      INTEGER,
  -- Which inbound message triggered this reply
  -- NULL for inbound messages
  responding_to_msg_id  UUID REFERENCES email_thread_messages(id),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Unique index on (thread_id, gmail_message_id) for safe upserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_etm_thread_msg
  ON email_thread_messages(thread_id, gmail_message_id);

-- Also keep single-column index for any legacy upsert paths
CREATE UNIQUE INDEX IF NOT EXISTS idx_etm_gmail_msg_id
  ON email_thread_messages(gmail_message_id);

CREATE INDEX IF NOT EXISTS idx_etm_thread
  ON email_thread_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_etm_owner
  ON email_thread_messages(owner_member_id);
CREATE INDEX IF NOT EXISTS idx_etm_direction
  ON email_thread_messages(direction, sent_at);

-- Add new columns to existing table (idempotent)
ALTER TABLE email_thread_messages
  ADD COLUMN IF NOT EXISTS owner_member_id      UUID REFERENCES team_members(id),
  ADD COLUMN IF NOT EXISTS from_name            TEXT,
  ADD COLUMN IF NOT EXISTS snippet              TEXT,
  ADD COLUMN IF NOT EXISTS responding_to_msg_id UUID REFERENCES email_thread_messages(id);

-- ─────────────────────────────────────────────
-- Add tracking columns to email_threads
-- ─────────────────────────────────────────────
ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS reply_count            INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message_count          INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_replied_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_response_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS last_replied_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_inbound_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_outbound_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS awaiting_reply_since   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_resolved            BOOLEAN DEFAULT FALSE;

-- Add source to existing email_replies
ALTER TABLE email_replies
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'app'
    CHECK (source IN ('app','gmail')),
  ADD COLUMN IF NOT EXISTS is_first_reply BOOLEAN DEFAULT FALSE;

-- ─────────────────────────────────────────────
-- RLS on new table
-- ─────────────────────────────────────────────
ALTER TABLE email_thread_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "etm_service_role_all"     ON email_thread_messages;
DROP POLICY IF EXISTS "etm_authenticated_read"   ON email_thread_messages;
DROP POLICY IF EXISTS "messages_visibility"      ON email_thread_messages;
DROP POLICY IF EXISTS "messages_own_write"       ON email_thread_messages;

CREATE POLICY "etm_service_role_all" ON email_thread_messages
  FOR ALL TO service_role USING (true);

CREATE POLICY "messages_visibility" ON email_thread_messages
  FOR SELECT TO authenticated
  USING (
    thread_id IN (
      SELECT id FROM email_threads
      WHERE owner_member_id IN (SELECT get_visible_member_ids())
    )
  );

CREATE POLICY "messages_own_write" ON email_thread_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_member_id = (
      SELECT id FROM team_members WHERE supabase_uid = auth.uid()
    )
  );

-- ─────────────────────────────────────────────
-- Updated member_response_stats view
-- ─────────────────────────────────────────────
DROP VIEW IF EXISTS member_response_stats;

CREATE OR REPLACE VIEW member_response_stats AS
SELECT
  m.id,
  m.name,
  m.email,
  m.role,
  COUNT(DISTINCT t.id)                                          AS total_emails,
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.reply_status = 'replied')                          AS replied_count,
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.reply_status = 'pending')                          AS pending_count,
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.reply_status = 'overdue')                          AS overdue_count,
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.received_at > NOW() - INTERVAL '24h')              AS emails_today,
  ROUND(AVG(t.response_minutes))                               AS avg_response_minutes,
  MIN(t.response_minutes)                                      AS fastest_minutes,
  MAX(t.response_minutes)                                      AS slowest_minutes,
  ROUND(
    100.0
    * COUNT(DISTINCT t.id) FILTER (
        WHERE t.response_minutes <= 120
        AND   t.reply_status = 'replied')
    / NULLIF(COUNT(DISTINCT t.id) FILTER (
        WHERE t.reply_status = 'replied'), 0)
  )                                                            AS on_time_pct,
  -- Total messages sent (all replies, not just first)
  COUNT(msg.id) FILTER (
    WHERE msg.direction = 'outbound')                          AS total_replies_sent,
  -- Reply source breakdown
  COUNT(msg.id) FILTER (
    WHERE msg.direction = 'outbound'
    AND   msg.source = 'app')                                  AS app_reply_count,
  COUNT(msg.id) FILTER (
    WHERE msg.direction = 'outbound'
    AND   msg.source = 'gmail')                                AS gmail_reply_count,
  -- Average follow-up response time (not just first reply)
  ROUND(AVG(msg.response_minutes) FILTER (
    WHERE msg.direction = 'outbound'))                         AS avg_followup_minutes,
  -- Threads currently awaiting reply
  COUNT(DISTINCT t.id) FILTER (
    WHERE t.awaiting_reply_since IS NOT NULL
    AND   t.is_resolved = FALSE)                               AS awaiting_reply_count
FROM team_members m
LEFT JOIN email_threads t   ON t.owner_member_id = m.id
LEFT JOIN email_thread_messages msg ON msg.thread_id = t.id
WHERE m.is_active = TRUE
GROUP BY m.id, m.name, m.email, m.role;

-- ─────────────────────────────────────────────
-- Thread timeline view (used in ThreadDetailPanel)
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW thread_timeline AS
SELECT
  msg.id,
  msg.thread_id,
  msg.direction,
  msg.from_email,
  msg.from_name,
  msg.snippet,
  msg.sent_at,
  msg.source,
  msg.response_minutes,
  ROW_NUMBER() OVER (
    PARTITION BY msg.thread_id
    ORDER BY msg.sent_at ASC
  ) AS message_number,
  COUNT(*) OVER (
    PARTITION BY msg.thread_id
  ) AS total_messages
FROM email_thread_messages msg
ORDER BY msg.thread_id, msg.sent_at ASC;
