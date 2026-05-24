-- Migration 012: Add project_focus to agent_conversations
-- Stores the project/topic context the user selected at conversation start.
-- Used to prime the AI with focused context for more accurate answers.

ALTER TABLE agent_conversations
  ADD COLUMN IF NOT EXISTS project_focus text DEFAULT NULL;
