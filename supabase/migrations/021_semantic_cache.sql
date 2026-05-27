-- ============================================================
-- Migration 021: Semantic Cache for Agent Queries
--
-- Creates the semantic_cache table and an HNSW vector index to support
-- semantic query matching. Adds a trigger to automatically flush/clear
-- the cache whenever the email_knowledge_base changes.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.semantic_cache (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_text                  TEXT NOT NULL,
  embedding                   VECTOR(1024) NOT NULL,
  response_text               TEXT NOT NULL,
  response_type               TEXT NOT NULL,
  kb_entries_referenced       INTEGER NOT NULL DEFAULT 0,
  project_clusters_referenced TEXT[] NOT NULL DEFAULT '{}',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW vector similarity index for cached queries
CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding 
  ON public.semantic_cache USING hnsw (embedding vector_cosine_ops);

-- B-tree index for exact queries
CREATE INDEX IF NOT EXISTS idx_semantic_cache_query_text
  ON public.semantic_cache(query_text);

-- Cache invalidation trigger function
CREATE OR REPLACE FUNCTION clear_semantic_cache_on_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE TABLE public.semantic_cache;
  RETURN NULL;
END;
$$;

-- Flush the cache automatically when the knowledge base is updated (sync inserts/merges)
DROP TRIGGER IF EXISTS trg_clear_cache_on_kb_insert ON public.email_knowledge_base;
CREATE TRIGGER trg_clear_cache_on_kb_insert
  AFTER INSERT OR UPDATE ON public.email_knowledge_base
  FOR EACH STATEMENT
  EXECUTE FUNCTION clear_semantic_cache_on_sync();

-- Matches a query vector against cached query vectors
CREATE OR REPLACE FUNCTION match_semantic_cache(
  query_embedding vector(1024),
  match_threshold float
)
RETURNS TABLE (
  response_text               text,
  response_type               text,
  kb_entries_referenced       int,
  project_clusters_referenced text[]
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    response_text,
    response_type,
    kb_entries_referenced,
    project_clusters_referenced
  FROM semantic_cache
  WHERE 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding ASC
  LIMIT 1;
$$;
