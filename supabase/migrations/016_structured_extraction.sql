-- ============================================================
-- Migration 016: Structured Extraction Tables
--
-- Creates three operational tables that are populated at email
-- index time from AI-extracted data:
--
--   project_action_items  — tasks with owner + status tracking
--   project_blockers      — impediments blocking progress
--   project_followups     — threads awaiting an external response
--
-- These enable precise SQL queries like:
--   "Give me all open tasks for Infosys"
--   "What are the active blockers?"
--   "Which follow-ups are more than 3 days old?"
-- ============================================================

-- ─── project_action_items ────────────────────────────────────
-- One row per action item extracted from an email thread.

CREATE TABLE IF NOT EXISTS project_action_items (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kb_entry_id  uuid        REFERENCES email_knowledge_base(id) ON DELETE CASCADE,
  project_cluster_id  uuid        REFERENCES project_clusters(id)      ON DELETE SET NULL,
  gmail_thread_id     text        NOT NULL,

  task_description    text        NOT NULL,
  -- Raw name from AI extraction (e.g. "Rahul", "Dev Team")
  owner_hint          text,
  -- Resolved to an actual team_member row (nullable — set when owner_hint matches a member name)
  assigned_member_id  uuid        REFERENCES team_members(id) ON DELETE SET NULL,

  due_date            date,
  status              text        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','in_progress','done','deferred')),
  priority            text        NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('high','medium','low')),

  -- When the source email was received (for aging / SLA tracking)
  source_date         timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_items_project
  ON project_action_items(project_cluster_id, status);

CREATE INDEX IF NOT EXISTS idx_action_items_member
  ON project_action_items(assigned_member_id, status);

CREATE INDEX IF NOT EXISTS idx_action_items_kb
  ON project_action_items(source_kb_entry_id);

CREATE INDEX IF NOT EXISTS idx_action_items_due
  ON project_action_items(due_date NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_action_items_priority
  ON project_action_items(project_cluster_id, priority, status);

-- ─── project_blockers ─────────────────────────────────────────
-- One row per blocker identified in an email thread.

CREATE TABLE IF NOT EXISTS project_blockers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kb_entry_id  uuid        REFERENCES email_knowledge_base(id) ON DELETE CASCADE,
  project_cluster_id  uuid        REFERENCES project_clusters(id)      ON DELETE SET NULL,
  gmail_thread_id     text        NOT NULL,

  description         text        NOT NULL,
  -- Who / what is being blocked
  blocking_whom       text,
  -- Who needs to act to resolve the blocker
  needs_action_from   text,
  -- Resolved team member who needs to act (if identifiable)
  action_member_id    uuid        REFERENCES team_members(id) ON DELETE SET NULL,

  status              text        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','resolved','stale')),
  raised_at           timestamptz,
  resolved_at         timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blockers_project
  ON project_blockers(project_cluster_id, status);

CREATE INDEX IF NOT EXISTS idx_blockers_status
  ON project_blockers(status, raised_at DESC);

CREATE INDEX IF NOT EXISTS idx_blockers_kb
  ON project_blockers(source_kb_entry_id);

-- ─── project_followups ────────────────────────────────────────
-- One row per email thread where we are awaiting an external response.

CREATE TABLE IF NOT EXISTS project_followups (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kb_entry_id  uuid        REFERENCES email_knowledge_base(id) ON DELETE CASCADE,
  project_cluster_id  uuid        REFERENCES project_clusters(id)      ON DELETE SET NULL,
  gmail_thread_id     text        NOT NULL,

  subject             text,
  -- Who we are waiting on (client name, external party, etc.)
  awaiting_from       text        NOT NULL,

  -- When the email that triggered the follow-up was sent
  sent_at             timestamptz,

  status              text        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','responded','cancelled')),

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_followups_project
  ON project_followups(project_cluster_id, status);

CREATE INDEX IF NOT EXISTS idx_followups_pending
  ON project_followups(status, sent_at ASC);

CREATE INDEX IF NOT EXISTS idx_followups_kb
  ON project_followups(source_kb_entry_id);

-- ─── Row Level Security ───────────────────────────────────────
-- Service-role bypasses RLS (used server-side only).

ALTER TABLE project_action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_blockers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_followups    ENABLE ROW LEVEL SECURITY;

-- ─── Auto-update updated_at on status change ─────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_action_items_updated_at ON project_action_items;
CREATE TRIGGER trg_action_items_updated_at
  BEFORE UPDATE ON project_action_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_blockers_updated_at ON project_blockers;
CREATE TRIGGER trg_blockers_updated_at
  BEFORE UPDATE ON project_blockers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_followups_updated_at ON project_followups;
CREATE TRIGGER trg_followups_updated_at
  BEFORE UPDATE ON project_followups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
