-- ============================================================
-- Migration 019: Dynamic Operational Items Consolidation
--
-- Consolidates project_action_items, project_blockers, and project_followups
-- into a single, unified, dynamic table: project_operational_items.
-- ============================================================

-- ─── 1. Create the unified dynamic table ─────────────────────

CREATE TABLE IF NOT EXISTS public.project_operational_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kb_entry_id  UUID NOT NULL REFERENCES public.email_knowledge_base(id) ON DELETE CASCADE,
  project_cluster_id  UUID REFERENCES public.project_clusters(id) ON DELETE CASCADE,
  gmail_thread_id     TEXT NOT NULL,
  category            TEXT NOT NULL, -- 'action_item', 'blocker', 'follow_up', 'decision', 'risk', etc.
  description         TEXT NOT NULL,
  owner_hint          TEXT,
  assigned_member_id  UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'open',
  priority            TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  due_date            DATE,
  source_date         TIMESTAMPTZ NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast dynamic queries
CREATE INDEX IF NOT EXISTS idx_operational_project_category_status
  ON public.project_operational_items (project_cluster_id, category, status);

CREATE INDEX IF NOT EXISTS idx_operational_assigned_member
  ON public.project_operational_items (assigned_member_id);

CREATE INDEX IF NOT EXISTS idx_operational_metadata_gin
  ON public.project_operational_items USING GIN (metadata);

-- ─── 2. Migrate existing data (if any exists) ────────────────

-- Action items
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'project_action_items') THEN
    INSERT INTO public.project_operational_items (
      id, source_kb_entry_id, project_cluster_id, gmail_thread_id,
      category, description, owner_hint, assigned_member_id,
      due_date, status, priority, source_date
    )
    SELECT
      id, source_kb_entry_id, project_cluster_id, gmail_thread_id,
      'action_item', task_description, owner_hint, assigned_member_id,
      due_date, status, priority, source_date
    FROM public.project_action_items
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Blockers
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'project_blockers') THEN
    INSERT INTO public.project_operational_items (
      id, source_kb_entry_id, project_cluster_id, gmail_thread_id,
      category, description, owner_hint, assigned_member_id,
      status, priority, source_date, metadata
    )
    SELECT
      id, source_kb_entry_id, project_cluster_id, gmail_thread_id,
      'blocker', description, needs_action_from, action_member_id,
      status, 'high', raised_at, jsonb_build_object('blocking_whom', COALESCE(blocking_whom, ''))
    FROM public.project_blockers
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Follow-ups
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'project_followups') THEN
    INSERT INTO public.project_operational_items (
      id, source_kb_entry_id, project_cluster_id, gmail_thread_id,
      category, description, owner_hint,
      status, priority, source_date, metadata
    )
    SELECT
      id, source_kb_entry_id, project_cluster_id, gmail_thread_id,
      'follow_up', 'Awaiting response from: ' || awaiting_from, awaiting_from,
      status, 'medium', sent_at, jsonb_build_object('subject', COALESCE(subject, ''))
    FROM public.project_followups
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ─── 3. Drop old tables ──────────────────────────────────────

DROP TABLE IF EXISTS public.project_action_items CASCADE;
DROP TABLE IF EXISTS public.project_blockers CASCADE;
DROP TABLE IF EXISTS public.project_followups CASCADE;

-- ─── 4. Recreate precision query wrappers (for backward compatibility) ───

-- 4.1 Action Items
CREATE OR REPLACE FUNCTION get_project_action_items(
  p_cluster_id  uuid,
  p_status      text    DEFAULT 'open'
)
RETURNS TABLE (
  id                  uuid,
  task_description    text,
  owner_hint          text,
  assigned_member_id  uuid,
  due_date            date,
  status              text,
  priority            text,
  source_date         timestamptz,
  gmail_thread_id     text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    id,
    description AS task_description,
    owner_hint,
    assigned_member_id,
    due_date,
    status,
    priority,
    source_date,
    gmail_thread_id
  FROM public.project_operational_items
  WHERE project_cluster_id = p_cluster_id
    AND category = 'action_item'
    AND (p_status = 'all' OR status = p_status)
  ORDER BY
    CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
    due_date ASC NULLS LAST,
    source_date DESC NULLS LAST;
$$;

-- 4.2 Blockers
CREATE OR REPLACE FUNCTION get_project_blockers(
  p_cluster_id  uuid    DEFAULT NULL,
  p_status      text    DEFAULT 'open'
)
RETURNS TABLE (
  id                uuid,
  description       text,
  blocking_whom     text,
  needs_action_from text,
  status            text,
  raised_at         timestamptz,
  days_open         int,
  gmail_thread_id   text,
  project_name      text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    o.id,
    o.description,
    COALESCE(o.metadata->>'blocking_whom', '') AS blocking_whom,
    o.owner_hint AS needs_action_from,
    o.status,
    o.source_date AS raised_at,
    EXTRACT(DAY FROM now() - o.source_date)::int AS days_open,
    o.gmail_thread_id,
    pc.name AS project_name
  FROM public.project_operational_items o
  LEFT JOIN public.project_clusters pc ON pc.id = o.project_cluster_id
  WHERE o.category = 'blocker'
    AND (p_cluster_id IS NULL OR o.project_cluster_id = p_cluster_id)
    AND (p_status = 'all' OR o.status = p_status)
  ORDER BY o.source_date ASC;
$$;

-- 4.3 Follow-ups
CREATE OR REPLACE FUNCTION get_project_followups(
  p_cluster_id  uuid    DEFAULT NULL,
  p_status      text    DEFAULT 'pending'
)
RETURNS TABLE (
  id              uuid,
  subject         text,
  awaiting_from   text,
  sent_at         timestamptz,
  days_pending    int,
  status          text,
  gmail_thread_id text,
  project_name    text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    o.id,
    COALESCE(o.metadata->>'subject', '') AS subject,
    o.owner_hint AS awaiting_from,
    o.source_date AS sent_at,
    EXTRACT(DAY FROM now() - o.source_date)::int AS days_pending,
    o.status,
    o.gmail_thread_id,
    pc.name AS project_name
  FROM public.project_operational_items o
  LEFT JOIN public.project_clusters pc ON pc.id = o.project_cluster_id
  WHERE o.category = 'follow_up'
    AND (p_cluster_id IS NULL OR o.project_cluster_id = p_cluster_id)
    AND (p_status = 'all' OR o.status = p_status)
  ORDER BY o.source_date ASC;
$$;

-- 4.4 Ticket Sheet
CREATE OR REPLACE FUNCTION get_project_ticket_sheet(
  p_cluster_id  uuid
)
RETURNS TABLE (
  ticket_type  text,
  description  text,
  owner        text,
  due_date     date,
  status       text,
  priority     text,
  email_date   timestamptz,
  thread_link  text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    CASE category
      WHEN 'action_item' THEN 'ACTION'
      WHEN 'blocker'     THEN 'BLOCKER'
      WHEN 'follow_up'   THEN 'FOLLOW-UP'
      ELSE UPPER(category)
    END AS ticket_type,
    description,
    COALESCE(owner_hint, 'Unassigned') AS owner,
    due_date,
    status,
    priority,
    source_date AS email_date,
    'https://mail.google.com/mail/u/0/#inbox/' || gmail_thread_id AS thread_link
  FROM public.project_operational_items
  WHERE project_cluster_id = p_cluster_id
    AND category IN ('action_item', 'blocker', 'follow_up')
    AND status NOT IN ('done', 'deferred', 'resolved')
  ORDER BY
    CASE category WHEN 'blocker' THEN 1 WHEN 'action_item' THEN 2 ELSE 3 END,
    CASE priority WHEN 'high'    THEN 1 WHEN 'medium'      THEN 2 ELSE 3 END,
    source_date DESC NULLS LAST;
$$;

-- ─── 5. Create new generic retriever function for dynamic categories ───

CREATE OR REPLACE FUNCTION get_project_operational_items(
  p_cluster_id  uuid,
  p_category    text,
  p_status      text    DEFAULT 'all'
)
RETURNS TABLE (
  id                  uuid,
  category            text,
  description         text,
  owner_hint          text,
  assigned_member_id  uuid,
  due_date            date,
  status              text,
  priority            text,
  source_date         timestamptz,
  gmail_thread_id     text,
  metadata            jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    id, category, description, owner_hint, assigned_member_id,
    due_date, status, priority, source_date, gmail_thread_id, metadata
  FROM public.project_operational_items
  WHERE project_cluster_id = p_cluster_id
    AND (p_category = 'all' OR category = p_category)
    AND (p_status = 'all' OR status = p_status)
  ORDER BY source_date DESC;
$$;

-- ─── 6. Auto-update updated_at on status/row changes ─────────────────

DROP TRIGGER IF EXISTS trg_operational_items_updated_at ON public.project_operational_items;
CREATE TRIGGER trg_operational_items_updated_at
  BEFORE UPDATE ON public.project_operational_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
