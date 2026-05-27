-- ============================================================
-- Migration 020: Search Visibility Overhaul
--
-- Modifies search_kb_by_embedding and search_attachments_by_embedding
-- to check participant_member_ids array overlap (&&) in addition to
-- owner_member_id. This ensures CC'd thread members can see and search
-- email knowledge base entries and document attachments.
-- ============================================================

-- ─── 1. Overhaul KB Vector Search ────────────────────────────

CREATE OR REPLACE FUNCTION search_kb_by_embedding(
  query_embedding vector(1024),
  match_threshold float,
  match_count     int,
  member_ids      uuid[],
  date_from       timestamptz DEFAULT NULL,
  date_to         timestamptz DEFAULT NULL,
  cluster_id      uuid        DEFAULT NULL
)
RETURNS TABLE (
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
    kb.id,
    kb.owner_member_id,
    kb.project_cluster_id,
    kb.gmail_thread_id,
    kb.summary,
    kb.key_points,
    kb.action_items,
    kb.participant_domains,
    kb.direction,
    kb.email_date,
    kb.classification_confidence,
    kb.detected_project,
    kb.classification_source,
    kb.pii_was_masked,
    1 - (kb.embedding <=> query_embedding) AS similarity
  FROM email_knowledge_base kb
  WHERE
    (kb.owner_member_id = ANY(member_ids) OR kb.participant_member_ids && member_ids)
    AND kb.embedding IS NOT NULL
    AND 1 - (kb.embedding <=> query_embedding) > match_threshold
    AND (date_from  IS NULL OR kb.email_date >= date_from)
    AND (date_to    IS NULL OR kb.email_date <= date_to)
    AND (cluster_id IS NULL OR kb.project_cluster_id = cluster_id)
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ─── 2. Overhaul Attachment Vector Search ────────────────────

CREATE OR REPLACE FUNCTION search_attachments_by_embedding(
  query_embedding  vector(1024),
  match_threshold  float,
  match_count      int,
  member_ids       uuid[],
  date_from        timestamptz DEFAULT NULL,
  date_to          timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id               uuid,
  kb_entry_id      uuid,
  owner_member_id  uuid,
  gmail_thread_id  text,
  filename         text,
  mime_type        text,
  summary          text,
  key_points       text[],
  email_date       timestamptz,
  similarity       float
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    a.id,
    a.kb_entry_id,
    a.owner_member_id,
    a.gmail_thread_id,
    a.filename,
    a.mime_type,
    a.summary,
    a.key_points,
    a.email_date,
    1 - (a.embedding <=> query_embedding) AS similarity
  FROM email_attachments_kb a
  JOIN email_knowledge_base kb ON kb.id = a.kb_entry_id
  WHERE
    (kb.owner_member_id = ANY(member_ids) OR kb.participant_member_ids && member_ids)
    AND a.embedding   IS NOT NULL
    AND 1 - (a.embedding <=> query_embedding) > match_threshold
    AND (date_from IS NULL OR a.email_date >= date_from)
    AND (date_to   IS NULL OR a.email_date <= date_to)
  ORDER BY a.embedding <=> query_embedding
  LIMIT match_count;
$$;
