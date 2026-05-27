-- ============================================================
-- Migration 017: Precision Retrieval RPCs
--
-- SQL functions for structured, deterministic operational queries.
-- These are called directly by the AI agent for queries that need
-- exact results (not semantic approximations):
--
--   get_project_action_items  — open/filtered task list
--   get_project_blockers      — blocker list with aging
--   get_project_followups     — pending follow-ups with age
--   get_project_ticket_sheet  — combined view for all open items
--   get_visible_project_clusters (updated) — use participant_member_ids
--   get_project_kb_entries    (updated)    — use participant_member_ids
-- ============================================================

-- ─── 1. Open action items for a project ──────────────────────

CREATE OR REPLACE FUNCTION get_project_action_items(
  p_cluster_id  uuid,
  p_status      text    DEFAULT 'open'   -- 'open' | 'all' | 'done' etc.
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
    id, task_description, owner_hint, assigned_member_id,
    due_date, status, priority, source_date, gmail_thread_id
  FROM project_action_items
  WHERE project_cluster_id = p_cluster_id
    AND (p_status = 'all' OR status = p_status)
  ORDER BY
    CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
    due_date ASC NULLS LAST,
    source_date DESC NULLS LAST;
$$;

-- ─── 2. Blockers for a project (or all projects) ─────────────

CREATE OR REPLACE FUNCTION get_project_blockers(
  p_cluster_id  uuid    DEFAULT NULL,   -- NULL = all visible projects
  p_status      text    DEFAULT 'open'
)
RETURNS TABLE (
  id               uuid,
  description      text,
  blocking_whom    text,
  needs_action_from text,
  status           text,
  raised_at        timestamptz,
  days_open        int,
  gmail_thread_id  text,
  project_name     text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    b.id,
    b.description,
    b.blocking_whom,
    b.needs_action_from,
    b.status,
    b.raised_at,
    EXTRACT(DAY FROM now() - b.raised_at)::int AS days_open,
    b.gmail_thread_id,
    pc.name AS project_name
  FROM   project_blockers b
  LEFT   JOIN project_clusters pc ON pc.id = b.project_cluster_id
  WHERE  (p_cluster_id IS NULL OR b.project_cluster_id = p_cluster_id)
    AND  (p_status = 'all'      OR b.status = p_status)
  ORDER BY b.raised_at ASC;  -- oldest blockers first (most urgent)
$$;

-- ─── 3. Pending follow-ups ────────────────────────────────────

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
    f.id,
    f.subject,
    f.awaiting_from,
    f.sent_at,
    EXTRACT(DAY FROM now() - f.sent_at)::int AS days_pending,
    f.status,
    f.gmail_thread_id,
    pc.name AS project_name
  FROM   project_followups f
  LEFT   JOIN project_clusters pc ON pc.id = f.project_cluster_id
  WHERE  (p_cluster_id IS NULL OR f.project_cluster_id = p_cluster_id)
    AND  (p_status = 'all'      OR f.status = p_status)
  ORDER BY f.sent_at ASC;  -- oldest follow-ups first
$$;

-- ─── 4. Comprehensive ticket sheet ───────────────────────────
-- Combines action items + blockers + follow-ups into one unified
-- view for generating an "open work" report for any project.

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
    ticket_type,
    description,
    owner,
    due_date,
    status,
    priority,
    email_date,
    thread_link
  FROM (
    -- Open action items
    SELECT
      'ACTION'   AS ticket_type,
      task_description AS description,
      COALESCE(owner_hint, 'Unassigned') AS owner,
      due_date,
      status,
      priority,
      source_date AS email_date,
      'https://mail.google.com/mail/u/0/#inbox/' || gmail_thread_id AS thread_link
    FROM   project_action_items
    WHERE  project_cluster_id = p_cluster_id
      AND  status NOT IN ('done', 'deferred')

    UNION ALL

    -- Open blockers (always high priority)
    SELECT
      'BLOCKER'  AS ticket_type,
      description,
      COALESCE(needs_action_from, blocking_whom, 'Unknown') AS owner,
      NULL        AS due_date,
      status,
      'high'      AS priority,
      raised_at   AS email_date,
      'https://mail.google.com/mail/u/0/#inbox/' || gmail_thread_id AS thread_link
    FROM   project_blockers
    WHERE  project_cluster_id = p_cluster_id
      AND  status = 'open'

    UNION ALL

    -- Pending follow-ups
    SELECT
      'FOLLOW-UP' AS ticket_type,
      'Awaiting response from: ' || awaiting_from AS description,
      awaiting_from AS owner,
      NULL          AS due_date,
      status,
      'medium'      AS priority,
      sent_at       AS email_date,
      'https://mail.google.com/mail/u/0/#inbox/' || gmail_thread_id AS thread_link
    FROM   project_followups
    WHERE  project_cluster_id = p_cluster_id
      AND  status = 'pending'
  ) sub
  ORDER BY
    CASE ticket_type WHEN 'BLOCKER' THEN 1 WHEN 'ACTION' THEN 2 ELSE 3 END,
    CASE priority    WHEN 'high'    THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
    email_date DESC NULLS LAST;
$$;

-- ─── 5. Update get_project_kb_entries to use participant_member_ids ──
-- Previously filtered by owner_member_id = ANY(p_member_ids).
-- Now: a thread is visible if ANY of the member's team is in participant_member_ids.
-- This means CC'd members can also see the thread's KB entry.

CREATE OR REPLACE FUNCTION get_project_kb_entries(
  p_cluster_id  uuid,
  p_member_ids  uuid[],
  p_limit       int DEFAULT 40
)
RETURNS SETOF email_knowledge_base
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT *
  FROM   email_knowledge_base
  WHERE  project_cluster_id = p_cluster_id
    AND  (
      -- Primary owner is a visible member
      owner_member_id = ANY(p_member_ids)
      OR
      -- Or at least one visible member was a participant (To/CC)
      participant_member_ids && p_member_ids
    )
  ORDER BY email_date DESC
  LIMIT  p_limit;
$$;

-- ─── 6. Update get_visible_project_clusters similarly ─────────

CREATE OR REPLACE FUNCTION get_visible_project_clusters(
  p_member_ids  uuid[]
)
RETURNS TABLE(
  id                uuid,
  name              text,
  entry_count       bigint,
  last_activity_at  timestamptz,
  involved_members  uuid[]
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    pc.id,
    pc.name,
    COUNT(ekb.id)          AS entry_count,
    MAX(ekb.email_date)    AS last_activity_at,
    pc.involved_member_ids AS involved_members
  FROM   project_clusters pc
  JOIN   email_knowledge_base ekb
         ON ekb.project_cluster_id = pc.id
        AND (
          ekb.owner_member_id        = ANY(p_member_ids)
          OR
          ekb.participant_member_ids && p_member_ids
        )
  GROUP  BY pc.id, pc.name, pc.involved_member_ids
  ORDER  BY MAX(ekb.email_date) DESC;
$$;

-- ─── 7. Update search_kb_by_embedding_in_project similarly ────

CREATE OR REPLACE FUNCTION search_kb_by_embedding_in_project(
  query_embedding  vector(1024),
  match_threshold  float,
  match_count      int,
  member_ids       uuid[],
  cluster_id       uuid
)
RETURNS TABLE(
  id                        uuid,
  owner_member_id           uuid,
  project_cluster_id        uuid,
  gmail_thread_id           text,
  summary                   text,
  key_points                text[],
  action_items              jsonb,
  participant_domains       text[],
  direction                 text,
  email_date                timestamptz,
  classification_confidence float,
  detected_project          text,
  classification_source     text,
  pii_was_masked            boolean,
  similarity                float
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    ekb.id,
    ekb.owner_member_id,
    ekb.project_cluster_id,
    ekb.gmail_thread_id,
    ekb.summary,
    ekb.key_points,
    ekb.action_items,
    ekb.participant_domains,
    ekb.direction,
    ekb.email_date,
    ekb.classification_confidence,
    ekb.detected_project,
    ekb.classification_source,
    ekb.pii_was_masked,
    1 - (ekb.embedding <=> query_embedding) AS similarity
  FROM   email_knowledge_base ekb
  WHERE  (ekb.owner_member_id = ANY(member_ids) OR ekb.participant_member_ids && member_ids)
    AND  ekb.project_cluster_id = cluster_id
    AND  ekb.embedding          IS NOT NULL
    AND  1 - (ekb.embedding <=> query_embedding) > match_threshold
  ORDER  BY ekb.embedding <=> query_embedding
  LIMIT  match_count;
$$;

-- ─── 8. Update get_multi_project_kb_summary similarly ─────────

CREATE OR REPLACE FUNCTION get_multi_project_kb_summary(
  p_member_ids          uuid[],
  p_limit_per_project   int DEFAULT 10
)
RETURNS SETOF email_knowledge_base
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT *
  FROM   email_knowledge_base
  WHERE  (
    owner_member_id        = ANY(p_member_ids)
    OR
    participant_member_ids && p_member_ids
  )
    AND  project_cluster_id IS NOT NULL
  ORDER  BY email_date DESC
  LIMIT  p_limit_per_project * 20;
$$;
