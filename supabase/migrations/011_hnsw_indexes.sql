-- Migration 011: HNSW vector indexes for production-scale search
-- Required when email_knowledge_base or email_attachments_kb has 5000+ rows.
-- HNSW (Hierarchical Navigable Small World) gives sub-linear ANN search
-- vs the default exact cosine scan which is O(n) and degrades at scale.
--
-- Run this AFTER data is loaded — building HNSW on an empty table is instant
-- but the index is most effective built once a significant corpus exists.

CREATE INDEX IF NOT EXISTS idx_kb_embedding_hnsw
  ON email_knowledge_base
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_attachments_embedding_hnsw
  ON email_attachments_kb
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
