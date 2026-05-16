-- Junction table: member reports to manager(s)
CREATE TABLE IF NOT EXISTS team_member_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   UUID NOT NULL REFERENCES team_members(id)
                ON DELETE CASCADE,
  manager_id  UUID NOT NULL REFERENCES team_members(id)
                ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(member_id, manager_id)
);

CREATE INDEX IF NOT EXISTS idx_tmr_member
  ON team_member_reports(member_id);
CREATE INDEX IF NOT EXISTS idx_tmr_manager
  ON team_member_reports(manager_id);

-- RLS
ALTER TABLE team_member_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tmr_all" ON team_member_reports
  FOR ALL USING (true);

---09` Function: get all member IDs visible to a given manager
-- Returns: their own ID + all members assigned to them
CREATE OR REPLACE FUNCTION get_assigned_member_ids(mgr_id UUID)
RETURNS SETOF UUID AS $$
  SELECT member_id
  FROM team_member_reports
  WHERE manager_id = mgr_id
  UNION
  SELECT mgr_id  -- always include self
$$ LANGUAGE sql STABLE;

-- Function: get all member IDs visible to delivery_lead
-- Returns: everyone
CREATE OR REPLACE FUNCTION get_all_active_member_ids()
RETURNS SETOF UUID AS $$
  SELECT id FROM team_members WHERE is_active = TRUE
$$ LANGUAGE sql STABLE;
