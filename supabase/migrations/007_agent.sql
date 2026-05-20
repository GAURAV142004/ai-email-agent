-- Agent conversations
CREATE TABLE IF NOT EXISTS agent_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   UUID NOT NULL REFERENCES team_members(id)
                ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'New Query',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ac_member
  ON agent_conversations(member_id, updated_at DESC);

-- Agent messages
CREATE TABLE IF NOT EXISTS agent_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL
                     REFERENCES agent_conversations(id)
                     ON DELETE CASCADE,
  role             TEXT NOT NULL
                     CHECK (role IN ('user','assistant')),
  content          TEXT NOT NULL,
  threads_fetched  INTEGER DEFAULT 0,
  threads_analyzed INTEGER DEFAULT 0,
  action_items     JSONB DEFAULT '[]',
  timeline         JSONB DEFAULT '[]',
  thread_ids       UUID[] DEFAULT '{}',
  tokens_used      INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_am_conversation
  ON agent_messages(conversation_id, created_at ASC);

ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages      ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_conv_all" ON agent_conversations
  FOR ALL USING (true);
CREATE POLICY "agent_msg_all"  ON agent_messages
  FOR ALL USING (true);
