-- Add is_paused flag to conversations for auto-muting AI after handoff
ALTER TABLE conversations ADD COLUMN is_paused boolean NOT NULL DEFAULT false;
CREATE INDEX idx_conversations_is_paused ON conversations(is_paused);
