-- ─────────────────────────────────────────────────────────────────────────────
-- 004_fix_supabase_uid.sql
-- Drop auth.users foreign key — this app uses NextAuth not Supabase Auth,
-- so auth.users is never populated and the FK causes a violation on every login.
-- Change supabase_uid to TEXT so it can store NextAuth public.users.id.
--
-- Must drop all RLS policies/functions that reference supabase_uid first,
-- alter the column, then recreate them with auth.uid()::TEXT casting.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: Drop all policies that reference supabase_uid (directly or via function)

DROP POLICY IF EXISTS "messages_own_write"    ON public.email_thread_messages;
DROP POLICY IF EXISTS "messages_visibility"   ON public.email_thread_messages;
DROP POLICY IF EXISTS "replies_write_own"     ON public.email_replies;
DROP POLICY IF EXISTS "replies_read_visible"  ON public.email_replies;
DROP POLICY IF EXISTS "tokens_own_only"       ON public.member_gmail_tokens;
DROP POLICY IF EXISTS "members_admin_write"   ON public.team_members;
DROP POLICY IF EXISTS "members_read_visible"  ON public.team_members;

-- ── Step 2: Drop helper function that references supabase_uid

DROP FUNCTION IF EXISTS get_visible_member_ids();

-- ── Step 3: Drop FK and change column type

ALTER TABLE public.team_members
  DROP CONSTRAINT IF EXISTS team_members_supabase_uid_fkey;

ALTER TABLE public.team_members
  ALTER COLUMN supabase_uid TYPE TEXT;

-- ── Step 4: Recreate function — cast auth.uid() to TEXT for comparison

CREATE OR REPLACE FUNCTION get_visible_member_ids()
RETURNS SETOF UUID AS $$
DECLARE viewer_role team_role;
BEGIN
  SELECT tm.role INTO viewer_role
  FROM public.team_members tm
  WHERE tm.supabase_uid = auth.uid()::TEXT
  AND tm.is_active = TRUE;

  RETURN QUERY
  SELECT id FROM public.team_members
  WHERE role = ANY(get_visible_roles(viewer_role))
  AND is_active = TRUE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ── Step 5: Recreate all policies

CREATE POLICY "members_read_visible" ON public.team_members FOR SELECT
  USING (id IN (SELECT get_visible_member_ids()));

CREATE POLICY "members_admin_write" ON public.team_members FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.team_members
    WHERE supabase_uid = auth.uid()::TEXT AND role = 'delivery_lead'
  ));

CREATE POLICY "tokens_own_only" ON public.member_gmail_tokens FOR ALL
  USING (member_id = (
    SELECT id FROM public.team_members WHERE supabase_uid = auth.uid()::TEXT
  ));

CREATE POLICY "replies_read_visible" ON public.email_replies FOR SELECT
  USING (thread_id IN (
    SELECT id FROM public.email_threads
    WHERE owner_member_id IN (SELECT get_visible_member_ids())
  ));

CREATE POLICY "replies_write_own" ON public.email_replies FOR INSERT
  WITH CHECK (sent_by_member = (
    SELECT id FROM public.team_members WHERE supabase_uid = auth.uid()::TEXT
  ));

CREATE POLICY "messages_visibility" ON public.email_thread_messages
  FOR SELECT TO authenticated
  USING (
    thread_id IN (
      SELECT id FROM public.email_threads
      WHERE owner_member_id IN (SELECT get_visible_member_ids())
    )
  );

CREATE POLICY "messages_own_write" ON public.email_thread_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_member_id = (
      SELECT id FROM public.team_members WHERE supabase_uid = auth.uid()::TEXT
    )
  );
