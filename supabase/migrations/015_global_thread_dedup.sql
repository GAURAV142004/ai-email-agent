-- ============================================================
-- Migration 015: Global Thread Deduplication + Participant Tracking
--
-- Key changes:
--   1. Deduplicate email_knowledge_base so there is ONE entry
--      per gmail_thread_id across ALL members (not one per member).
--   2. Add to_emails / cc_emails / participant_member_ids columns
--      so we know exactly who was involved in each thread.
--   3. Add mentioned_persons column for AI-extracted names from body.
--   4. Add email_type, urgency, awaiting_response_from, decisions_made
--      for precision structured queries.
--   5. Update the full-text search_vector function & trigger to
--      include the new fields.
-- ============================================================

-- ─── 1. Deduplicate existing rows ────────────────────────────
-- Keep the OLDEST entry per gmail_thread_id; discard duplicates.
-- Safe to run on an empty table.
DELETE FROM email_knowledge_base
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY gmail_thread_id
             ORDER BY created_at ASC
           ) AS rn
    FROM email_knowledge_base
  ) ranked
  WHERE rn > 1
);

-- ─── 2. Add new columns ───────────────────────────────────────

ALTER TABLE email_knowledge_base
  ADD COLUMN IF NOT EXISTS to_emails              text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cc_emails              text[]  NOT NULL DEFAULT '{}',
  -- All team_member IDs directly or CC'd in this thread
  ADD COLUMN IF NOT EXISTS participant_member_ids uuid[]  NOT NULL DEFAULT '{}',
  -- Names mentioned as responsible in the email body (AI-extracted)
  ADD COLUMN IF NOT EXISTS mentioned_persons      text[]  NOT NULL DEFAULT '{}',
  -- Semantic type of this email (classification for routing)
  ADD COLUMN IF NOT EXISTS email_type             text    NOT NULL DEFAULT 'information'
    CHECK (email_type IN (
      'action_request','status_update','blocker','decision',
      'follow_up','information','meeting','other'
    )),
  -- Urgency level
  ADD COLUMN IF NOT EXISTS urgency                text    NOT NULL DEFAULT 'medium'
    CHECK (urgency IN ('high','medium','low')),
  -- Who are we waiting on for a response (if any)
  ADD COLUMN IF NOT EXISTS awaiting_response_from text,
  -- Key decisions made in this email thread
  ADD COLUMN IF NOT EXISTS decisions_made         text[]  NOT NULL DEFAULT '{}';

-- ─── 3. Replace per-member unique with global unique ─────────
-- Drop the old (gmail_thread_id, owner_member_id) unique constraint.
ALTER TABLE email_knowledge_base
  DROP CONSTRAINT IF EXISTS email_knowledge_base_gmail_thread_id_owner_member_id_key;

-- Add global uniqueness: exactly ONE KB entry per Gmail thread.
ALTER TABLE email_knowledge_base
  DROP CONSTRAINT IF EXISTS email_knowledge_base_gmail_thread_id_key;
ALTER TABLE email_knowledge_base
  ADD CONSTRAINT email_knowledge_base_gmail_thread_id_key UNIQUE (gmail_thread_id);

-- ─── 4. New indexes ───────────────────────────────────────────

-- GIN index for participant_member_ids array lookups
CREATE INDEX IF NOT EXISTS idx_kb_participants
  ON email_knowledge_base USING GIN(participant_member_ids);

-- B-tree indexes for email_type and urgency (used in structured queries)
CREATE INDEX IF NOT EXISTS idx_kb_email_type
  ON email_knowledge_base(email_type);

CREATE INDEX IF NOT EXISTS idx_kb_urgency
  ON email_knowledge_base(project_cluster_id, urgency);

-- ─── 5. Update full-text search vector function ───────────────
-- Extend to include decisions_made and mentioned_persons so the
-- GIN index covers all new extractable content.

CREATE OR REPLACE FUNCTION kb_build_search_vector(
  p_detected_project   text,
  p_summary            text,
  p_key_points         text[],
  p_action_items       jsonb,
  p_decisions_made     text[]  DEFAULT '{}',
  p_mentioned_persons  text[]  DEFAULT '{}'
) RETURNS tsvector
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  action_text text := '';
  item        jsonb;
BEGIN
  IF p_action_items IS NOT NULL AND jsonb_typeof(p_action_items) = 'array' THEN
    FOR item IN SELECT * FROM jsonb_array_elements(p_action_items) LOOP
      action_text := action_text
        || ' ' || COALESCE(item->>'task',       '')
        || ' ' || COALESCE(item->>'owner_hint', '');
    END LOOP;
  END IF;

  RETURN
    setweight(to_tsvector('english', COALESCE(p_detected_project, '')),                          'A') ||
    setweight(to_tsvector('english', COALESCE(p_summary, '')),                                   'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(p_key_points, ' '), '')),          'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(p_decisions_made, ' '), '')),      'B') ||
    setweight(to_tsvector('english', COALESCE(action_text, '')),                                 'C') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(p_mentioned_persons, ' '), '')), 'C');
END;
$$;

-- ─── 6. Update trigger to pass new fields ────────────────────

CREATE OR REPLACE FUNCTION trg_kb_search_vector_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := kb_build_search_vector(
    NEW.detected_project,
    NEW.summary,
    NEW.key_points,
    NEW.action_items,
    NEW.decisions_made,
    NEW.mentioned_persons
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kb_search_vector ON email_knowledge_base;
CREATE TRIGGER trg_kb_search_vector
  BEFORE INSERT OR UPDATE OF
    detected_project, summary, key_points, action_items,
    decisions_made, mentioned_persons
  ON email_knowledge_base
  FOR EACH ROW EXECUTE FUNCTION trg_kb_search_vector_fn();

-- ─── 7. Backfill search_vector for existing rows ─────────────

UPDATE email_knowledge_base
SET search_vector = kb_build_search_vector(
  detected_project, summary, key_points, action_items,
  decisions_made, mentioned_persons
)
WHERE search_vector IS NULL OR TRUE;  -- re-index all with new signature
