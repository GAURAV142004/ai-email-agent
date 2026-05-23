-- ============================================================
-- Migration 008: Clean-Slate Rebuild
-- Drops all previous tables and rebuilds for the new
-- Knowledge Base + Personal Email Assistant architecture.
-- ============================================================

-- ─── DROP EVERYTHING FROM PREVIOUS SCHEMA ───────────────────

DROP TABLE IF EXISTS agent_messages           CASCADE;
DROP TABLE IF EXISTS agent_conversations      CASCADE;
DROP TABLE IF EXISTS ai_logs                  CASCADE;
DROP TABLE IF EXISTS email_replies            CASCADE;
DROP TABLE IF EXISTS tasks                    CASCADE;
DROP TABLE IF EXISTS email_thread_messages    CASCADE;
DROP TABLE IF EXISTS email_threads            CASCADE;
DROP TABLE IF EXISTS member_gmail_tokens      CASCADE;
DROP TABLE IF EXISTS connected_accounts       CASCADE;
DROP TABLE IF EXISTS team_member_reports      CASCADE;
DROP TABLE IF EXISTS team_members             CASCADE;
DROP TABLE IF EXISTS users                    CASCADE;

DROP VIEW IF EXISTS member_response_stats     CASCADE;
DROP VIEW IF EXISTS stream_stats              CASCADE;

-- ─── EXTENSIONS ─────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
-- pg_cron is enabled at the Supabase project level (not via SQL)

-- ─── CORE AUTH TABLES ────────────────────────────────────────

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text UNIQUE NOT NULL,
  name        text,
  plan        text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text UNIQUE NOT NULL,
  name             text NOT NULL,
  role             text NOT NULL CHECK (role IN (
                     'delivery_lead','senior_ba','senior_mis',
                     'senior_developer','ba','mis','developer'
                   )),
  avatar_url       text,
  is_active        boolean NOT NULL DEFAULT true,
  supabase_uid     uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Gmail watch state
  watch_expiry     timestamptz,
  last_history_id  text,
  -- Consent tracking
  consent_given    boolean NOT NULL DEFAULT false,
  consent_at       timestamptz,
  consent_ip       text,
  consent_version  text DEFAULT '1.0',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_member_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  manager_id   uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(member_id, manager_id)
);

CREATE TABLE member_gmail_tokens (
  member_id     uuid PRIMARY KEY REFERENCES team_members(id) ON DELETE CASCADE,
  access_token  text NOT NULL,
  refresh_token text,
  expires_at    timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── ADMIN CONFIGURATION ─────────────────────────────────────

-- Global (org-wide) classification rules configured by delivery_lead
CREATE TABLE email_classification_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type    text NOT NULL CHECK (rule_type IN (
                 'client_domain',   -- e.g. "infosys.com"
                 'sender_email',    -- e.g. "pm@clientco.com"
                 'receiver_email',  -- e.g. alerts sent to a shared address
                 'subject_keyword', -- e.g. "Project Apollo"
                 'ai_inference'     -- flag: let AI decide (value is null)
               )),
  value        text,               -- null only for ai_inference type
  description  text,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES team_members(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── KNOWLEDGE BASE ──────────────────────────────────────────

-- AI-inferred project groupings across all team email activity
CREATE TABLE project_clusters (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,          -- AI-inferred: "Infosys Module 2 Delivery"
  description         text,
  inferred_keywords   text[] DEFAULT '{}',
  involved_member_ids uuid[] DEFAULT '{}',    -- team_members involved
  kb_entry_count      int NOT NULL DEFAULT 0,
  last_activity_at    timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Core knowledge base: summarised project emails with vector embeddings
-- Raw email content is NEVER stored here
CREATE TABLE email_knowledge_base (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_member_id           uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  project_cluster_id        uuid REFERENCES project_clusters(id) ON DELETE SET NULL,
  -- Gmail identifiers for dedup only (not for content access)
  gmail_thread_id           text NOT NULL,
  gmail_message_id          text,
  -- Derived, never raw
  summary                   text NOT NULL,
  key_points                text[] DEFAULT '{}',
  action_items              jsonb  NOT NULL DEFAULT '[]',
  -- "[]" — array of { task, owner_hint, due_date_hint }
  participant_domains       text[] DEFAULT '{}', -- email domains only, no personal addresses
  direction                 text CHECK (direction IN ('inbound','outbound','thread')),
  email_date                timestamptz,
  -- Classification metadata
  classification_confidence float,
  classification_reason     text,
  detected_project          text,
  classification_source     text CHECK (classification_source IN ('rule','ai','both')),
  -- Vector embedding (Titan Embed v2 = 1024 dims)
  embedding                 vector(1024),
  -- Audit fields
  pii_was_masked            boolean NOT NULL DEFAULT false,
  tokens_used               int,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE(gmail_thread_id, owner_member_id)
);

-- Background sync job tracking
CREATE TABLE kb_sync_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id         uuid REFERENCES team_members(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','completed','failed')),
  emails_processed  int NOT NULL DEFAULT 0,
  emails_skipped    int NOT NULL DEFAULT 0,
  kb_entries_added  int NOT NULL DEFAULT 0,
  errors            text[] DEFAULT '{}',
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ─── COMPLIANCE ──────────────────────────────────────────────

-- Immutable audit log of every chatbot query
CREATE TABLE compliance_audit_logs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queried_by              uuid NOT NULL REFERENCES team_members(id),
  query_text              text NOT NULL,
  query_about_member_id   uuid REFERENCES team_members(id), -- if query named a specific person
  was_blocked             boolean NOT NULL DEFAULT false,
  block_reason            text,
  personal_topics_found   text[] DEFAULT '{}',
  kb_entries_accessed     int NOT NULL DEFAULT 0,
  project_clusters_hit    text[] DEFAULT '{}',
  response_type           text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- ─── PERSONAL EMAIL ASSISTANT ────────────────────────────────

-- Owner-only inbox emails — auto-purged after 10 days
CREATE TABLE personal_inbox_emails (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  gmail_thread_id  text NOT NULL,
  gmail_message_id text NOT NULL,
  subject          text,
  from_email       text,
  from_name        text,
  snippet          text,               -- first 500 chars, for display only
  received_at      timestamptz,
  is_read          boolean NOT NULL DEFAULT false,
  -- AI-derived fields (from personal email analysis)
  ai_summary       text,
  ai_priority      text CHECK (ai_priority IN ('high','medium','low')),
  is_actionable    boolean NOT NULL DEFAULT false,
  reply_sent       boolean NOT NULL DEFAULT false,
  -- Retention
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '10 days'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(gmail_message_id, member_id)
);

-- Personal to-do list — independent of emails, user-managed
CREATE TABLE daily_todos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  title           text NOT NULL,
  notes           text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','in_progress','completed','deferred')),
  priority        text NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('high','medium','low')),
  due_date        date NOT NULL DEFAULT CURRENT_DATE,
  linked_email_id uuid REFERENCES personal_inbox_emails(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── CHATBOT (AGENT) ─────────────────────────────────────────

CREATE TABLE agent_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  title      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_messages (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id            uuid NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role                       text NOT NULL CHECK (role IN ('user','assistant')),
  content                    text NOT NULL,
  -- Assistant message metadata
  kb_entries_referenced      int NOT NULL DEFAULT 0,
  project_clusters_referenced text[] DEFAULT '{}',
  response_type              text DEFAULT 'text'
                               CHECK (response_type IN ('text','table','report','timeline','document')),
  document_filename          text,   -- set when a file was generated
  document_mime_type         text,
  tokens_used                int,
  was_blocked                boolean NOT NULL DEFAULT false,
  block_reason               text,
  created_at                 timestamptz NOT NULL DEFAULT now()
);

-- ─── INDEXES ─────────────────────────────────────────────────

-- KB semantic search (IVFFlat for cosine similarity)
CREATE INDEX IF NOT EXISTS idx_kb_embedding
  ON email_knowledge_base USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_kb_owner      ON email_knowledge_base(owner_member_id);
CREATE INDEX IF NOT EXISTS idx_kb_project    ON email_knowledge_base(project_cluster_id);
CREATE INDEX IF NOT EXISTS idx_kb_date       ON email_knowledge_base(email_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_kb_thread     ON email_knowledge_base(gmail_thread_id);

CREATE INDEX IF NOT EXISTS idx_personal_member  ON personal_inbox_emails(member_id);
CREATE INDEX IF NOT EXISTS idx_personal_expires ON personal_inbox_emails(expires_at);
CREATE INDEX IF NOT EXISTS idx_personal_rcvd    ON personal_inbox_emails(member_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_todos_member_date ON daily_todos(member_id, due_date DESC);

CREATE INDEX IF NOT EXISTS idx_audit_querier ON compliance_audit_logs(queried_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_about   ON compliance_audit_logs(query_about_member_id);

CREATE INDEX IF NOT EXISTS idx_sync_member   ON kb_sync_jobs(member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_conv    ON agent_messages(conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_cls_rules_active ON email_classification_rules(rule_type, is_active);

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────

ALTER TABLE users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members             ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_member_reports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_gmail_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_classification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_knowledge_base     ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_clusters         ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_sync_jobs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_audit_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_inbox_emails    ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_todos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_conversations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages           ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used server-side only).
-- Anon / authenticated policies below are for client-side safety net.

-- personal_inbox_emails: only owner can read their own
CREATE POLICY "personal_emails_owner_only"
  ON personal_inbox_emails FOR ALL
  USING (
    member_id IN (
      SELECT id FROM team_members WHERE supabase_uid = auth.uid()
    )
  );

-- daily_todos: only owner
CREATE POLICY "todos_owner_only"
  ON daily_todos FOR ALL
  USING (
    member_id IN (
      SELECT id FROM team_members WHERE supabase_uid = auth.uid()
    )
  );

-- agent_conversations: only owner
CREATE POLICY "agent_conv_owner_only"
  ON agent_conversations FOR ALL
  USING (
    member_id IN (
      SELECT id FROM team_members WHERE supabase_uid = auth.uid()
    )
  );

-- ─── AUTO-PURGE PERSONAL EMAILS (pg_cron) ────────────────────
-- Run at 02:00 UTC daily. Enable pg_cron in Supabase dashboard first.
-- Uncomment after confirming pg_cron extension is active:
--
-- SELECT cron.schedule(
--   'purge-expired-personal-emails',
--   '0 2 * * *',
--   $$ DELETE FROM personal_inbox_emails WHERE expires_at < now() $$
-- );

-- ─── HELPER FUNCTION: bump project cluster stats ─────────────
CREATE OR REPLACE FUNCTION update_project_cluster_stats()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.project_cluster_id IS NOT NULL THEN
    UPDATE project_clusters
    SET
      kb_entry_count   = kb_entry_count + 1,
      last_activity_at = GREATEST(last_activity_at, NEW.email_date),
      updated_at       = now()
    WHERE id = NEW.project_cluster_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kb_cluster_stats
  AFTER INSERT ON email_knowledge_base
  FOR EACH ROW EXECUTE FUNCTION update_project_cluster_stats();
