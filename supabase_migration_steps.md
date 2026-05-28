# Supabase Migration Steps for Parent-Child RAG

To support the industry-grade Parent-Child retrieval model, we need to update your database schema in Supabase. Please copy the SQL block below and run it inside the **SQL Editor** in your Supabase Dashboard.

## SQL Migration Commands

```sql
-- 1. Add masked_full_text to email_knowledge_base if not already present
ALTER TABLE email_knowledge_base 
ADD COLUMN IF NOT EXISTS masked_full_text text;

-- 2. Create email_kb_chunks table for granular text chunking
CREATE TABLE IF NOT EXISTS email_kb_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kb_entry_id uuid NOT NULL REFERENCES email_knowledge_base(id) ON DELETE CASCADE,
  chunk_text  text NOT NULL,
  embedding   vector(1024), -- Titan v2 Embeddings
  created_at  timestamptz DEFAULT now()
);

-- 3. Create HNSW index for high-performance vector search on chunks
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding_hnsw
  ON email_kb_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 4. Enable Row Level Security (RLS) on email_kb_chunks
ALTER TABLE email_kb_chunks ENABLE ROW LEVEL SECURITY;

-- 5. Create search function for matching chunks within a specific project
CREATE OR REPLACE FUNCTION search_kb_chunks_by_embedding_in_project(
  query_embedding  vector(1024),
  match_threshold  float,
  match_count      int,
  member_ids       uuid[],
  cluster_id       uuid
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
  chunk_text                text,
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
    ekc.chunk_text,
    1 - (ekc.embedding <=> query_embedding) AS similarity
  FROM   email_kb_chunks ekc
  JOIN   email_knowledge_base ekb ON ekc.kb_entry_id = ekb.id
  WHERE  (ekb.owner_member_id = ANY(member_ids) OR ekb.participant_member_ids && member_ids)
    AND  ekb.project_cluster_id = cluster_id
    AND  ekc.embedding          IS NOT NULL
    AND  1 - (ekc.embedding <=> query_embedding) > match_threshold
  ORDER  BY ekc.embedding <=> query_embedding
  LIMIT  match_count;
$$;
```

## Why These Changes Are Needed
1. **`masked_full_text`**: Saves the PII-masked raw email thread body to preserve complete context that would otherwise be lost in lossy summarization.
2. **`email_kb_chunks`**: Stores small segments of emails individually to prevent truncation during embedding generation and mapping.
3. **`idx_kb_chunks_embedding_hnsw`**: A Hierarchical Navigable Small World (HNSW) index allows sub-linear similarity search times at production scale.
4. **`search_kb_chunks_by_embedding_in_project`**: Performs vector search directly against chunks rather than the parent emails, but still returns the parent email's metadata (e.g. actions, key points, date) to allow precise contextual mapping.
