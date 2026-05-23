-- Migration 009: pgvector RPC for KB semantic search
-- Called by lib/kb/search.ts searchKB() function

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
LANGUAGE sql STABLE
AS $$
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
    kb.owner_member_id = ANY(member_ids)
    AND kb.embedding IS NOT NULL
    AND 1 - (kb.embedding <=> query_embedding) > match_threshold
    AND (date_from  IS NULL OR kb.email_date >= date_from)
    AND (date_to    IS NULL OR kb.email_date <= date_to)
    AND (cluster_id IS NULL OR kb.project_cluster_id = cluster_id)
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
$$;
