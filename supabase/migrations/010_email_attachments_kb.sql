-- Migration 010: Email attachment knowledge base
-- Stores parsed + summarized content of email attachments for agent search.
-- Linked to email_knowledge_base via kb_entry_id.

CREATE TABLE IF NOT EXISTS email_attachments_kb (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kb_entry_id      UUID        REFERENCES email_knowledge_base(id) ON DELETE CASCADE,
  owner_member_id  UUID        NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  gmail_message_id TEXT        NOT NULL,
  gmail_thread_id  TEXT        NOT NULL,
  filename         TEXT        NOT NULL,
  mime_type        TEXT,
  file_size_bytes  INTEGER,
  extracted_text   TEXT,         -- PII-masked raw text (up to 3000 chars)
  summary          TEXT,         -- AI-generated 2-3 sentence summary
  key_points       TEXT[]        DEFAULT '{}',
  embedding        VECTOR(1024), -- Amazon Titan Embed v2 — same as email_knowledge_base
  email_date       TIMESTAMPTZ,
  pii_was_masked   BOOLEAN       DEFAULT false,
  tokens_used      INTEGER       DEFAULT 0,
  created_at       TIMESTAMPTZ   DEFAULT NOW()
);

-- Lookup by member (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_attachments_kb_owner
  ON email_attachments_kb (owner_member_id);

-- Deduplication lookup
CREATE INDEX IF NOT EXISTS idx_attachments_kb_message_file
  ON email_attachments_kb (owner_member_id, gmail_message_id, filename);

-- Date-range filtering
CREATE INDEX IF NOT EXISTS idx_attachments_kb_date
  ON email_attachments_kb (email_date DESC);

-- ── RPC: semantic similarity search over attachments ─────────────────────────
-- Called by lib/kb/search.ts searchAttachments()
-- Mirrors the pattern of search_kb_by_embedding from migration 009.

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
LANGUAGE sql STABLE
AS $$
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
  WHERE
    a.owner_member_id = ANY(member_ids)
    AND a.embedding   IS NOT NULL
    AND 1 - (a.embedding <=> query_embedding) > match_threshold
    AND (date_from IS NULL OR a.email_date >= date_from)
    AND (date_to   IS NULL OR a.email_date <= date_to)
  ORDER BY a.embedding <=> query_embedding
  LIMIT match_count;
$$;
