-- ============================================================
-- Migration 018: Bootstrap Queue System
--
-- Creates the kb_bootstrap_queue table to support long-term (e.g. 6 months)
-- historical bootsrapping, and the claim_bootstrap_queue_batch RPC.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.kb_bootstrap_queue (
  id              BIGSERIAL PRIMARY KEY,
  member_id       UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique index to prevent duplicate queue items per member
CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_bootstrap_queue_member_thread 
  ON public.kb_bootstrap_queue (member_id, gmail_thread_id);

-- Index for fast status checks and ordering
CREATE INDEX IF NOT EXISTS idx_kb_bootstrap_queue_status_created
  ON public.kb_bootstrap_queue (status, created_at ASC);

-- Add tracking columns to kb_sync_jobs
ALTER TABLE public.kb_sync_jobs 
  ADD COLUMN IF NOT EXISTS total_queued INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_processed INTEGER DEFAULT 0;

-- Atomic claim function using SELECT ... FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION claim_bootstrap_queue_batch(p_batch_size integer)
RETURNS TABLE (
  id bigint,
  member_id uuid,
  gmail_thread_id text
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  UPDATE kb_bootstrap_queue
  SET status = 'processing',
      attempts = attempts + 1,
      updated_at = now()
  WHERE kb_bootstrap_queue.id IN (
    SELECT q.id
    FROM kb_bootstrap_queue q
    WHERE q.status = 'pending'
    ORDER BY q.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING kb_bootstrap_queue.id, kb_bootstrap_queue.member_id, kb_bootstrap_queue.gmail_thread_id;
END;
$$;
