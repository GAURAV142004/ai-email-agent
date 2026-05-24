-- ─────────────────────────────────────────────────────────────────────────────
-- 013_hybrid_search.sql
-- Adds PostgreSQL full-text search alongside vector similarity.
-- Combined with RRF (Reciprocal Rank Fusion) in app code for hybrid retrieval.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add tsvector column to email_knowledge_base
ALTER TABLE email_knowledge_base
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Function that builds tsvector from KB entry content
--    Weights: A = project name (highest), B = summary + key_points, C = action items
CREATE OR REPLACE FUNCTION kb_build_search_vector(
  p_detected_project text,
  p_summary          text,
  p_key_points       text[],
  p_action_items     jsonb
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
    setweight(to_tsvector('english', COALESCE(p_detected_project, '')),                   'A') ||
    setweight(to_tsvector('english', COALESCE(p_summary, '')),                            'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(p_key_points, ' '), '')),   'B') ||
    setweight(to_tsvector('english', COALESCE(action_text, '')),                          'C');
END;
$$;

-- 3. Backfill all existing rows
UPDATE email_knowledge_base
SET    search_vector = kb_build_search_vector(
         detected_project, summary, key_points, action_items
       )
WHERE  search_vector IS NULL;

-- 4. Trigger to keep search_vector current on every insert/update
CREATE OR REPLACE FUNCTION trg_kb_search_vector_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := kb_build_search_vector(
    NEW.detected_project, NEW.summary, NEW.key_points, NEW.action_items
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kb_search_vector ON email_knowledge_base;
CREATE TRIGGER trg_kb_search_vector
  BEFORE INSERT OR UPDATE OF detected_project, summary, key_points, action_items
  ON email_knowledge_base
  FOR EACH ROW EXECUTE FUNCTION trg_kb_search_vector_fn();

-- 5. GIN index — enables millisecond keyword search at any scale
CREATE INDEX IF NOT EXISTS idx_email_kb_search_vector_gin
  ON email_knowledge_base USING GIN(search_vector);

-- ─────────────────────────────────────────────────────────────────────────────
-- Hybrid search for email_attachments_kb (same pattern)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE email_attachments_kb
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION att_build_search_vector(
  p_filename   text,
  p_summary    text,
  p_key_points text[]
) RETURNS tsvector
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    setweight(to_tsvector('english', COALESCE(p_filename, '')),                          'A') ||
    setweight(to_tsvector('english', COALESCE(p_summary,  '')),                          'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(p_key_points, ' '), '')), 'B');
$$;

UPDATE email_attachments_kb
SET    search_vector = att_build_search_vector(filename, summary, key_points)
WHERE  search_vector IS NULL;

CREATE OR REPLACE FUNCTION trg_att_search_vector_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := att_build_search_vector(NEW.filename, NEW.summary, NEW.key_points);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_att_search_vector ON email_attachments_kb;
CREATE TRIGGER trg_att_search_vector
  BEFORE INSERT OR UPDATE OF filename, summary, key_points
  ON email_attachments_kb
  FOR EACH ROW EXECUTE FUNCTION trg_att_search_vector_fn();

CREATE INDEX IF NOT EXISTS idx_att_kb_search_vector_gin
  ON email_attachments_kb USING GIN(search_vector);
