-- ============================================================
-- Migration 014: Project-Scoped KB Search Functions
-- Adds SQL functions for fetching all KB entries for a project
-- cluster and listing visible project clusters.
-- ============================================================

-- ─── 1. Fetch ALL KB entries for a specific project cluster ──────────────────
-- Returns entries ordered by email_date descending (most recent first).
-- Used by the project-first KB strategy to give AI full project context.

CREATE OR REPLACE FUNCTION get_project_kb_entries(
  p_cluster_id  uuid,
  p_member_ids  uuid[],
  p_limit       int DEFAULT 40
)
RETURNS SETOF email_knowledge_base
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT *
  FROM   email_knowledge_base
  WHERE  project_cluster_id = p_cluster_id
    AND  owner_member_id    = ANY(p_member_ids)
  ORDER  BY email_date DESC
  LIMIT  p_limit;
$$;

-- ─── 2. Get all visible project clusters with entry counts ────────────────────
-- Returns cluster metadata + KB entry counts for the given member IDs.
-- Used to build the "which project are you asking about?" list.

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
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    pc.id,
    pc.name,
    COUNT(ekb.id)              AS entry_count,
    MAX(ekb.email_date)        AS last_activity_at,
    pc.involved_member_ids     AS involved_members
  FROM   project_clusters pc
  JOIN   email_knowledge_base ekb
         ON ekb.project_cluster_id = pc.id
        AND ekb.owner_member_id    = ANY(p_member_ids)
  GROUP  BY pc.id, pc.name, pc.involved_member_ids
  ORDER  BY MAX(ekb.email_date) DESC;
$$;

-- ─── 3. Vector search WITHIN a specific project cluster ───────────────────────
-- Used for targeted/specific queries when user asks about a specific detail
-- within a project. Narrows the embedding search to one cluster only.
-- Column types exactly match email_knowledge_base table definition.

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
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
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
  WHERE  ekb.owner_member_id    = ANY(member_ids)
    AND  ekb.project_cluster_id = cluster_id
    AND  ekb.embedding          IS NOT NULL
    AND  1 - (ekb.embedding <=> query_embedding) > match_threshold
  ORDER  BY ekb.embedding <=> query_embedding
  LIMIT  match_count;
$$;

-- ─── 4. Multi-project aggregation: latest N entries across all projects ───────
-- Used for cross-project aggregation queries like "all blockers" or
-- "go-live dates across all projects". Groups results by project.

CREATE OR REPLACE FUNCTION get_multi_project_kb_summary(
  p_member_ids          uuid[],
  p_limit_per_project   int DEFAULT 10
)
RETURNS SETOF email_knowledge_base
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT *
  FROM   email_knowledge_base
  WHERE  owner_member_id    = ANY(p_member_ids)
    AND  project_cluster_id IS NOT NULL
  ORDER  BY email_date DESC
  LIMIT  p_limit_per_project * 20;  -- broad cap, post-filtered in application
$$;
