-- Add paused_until to conversations for time-based AI pause (owner manual reply)
-- Also add last_reminder_at for debouncing unanswered-customer reminders
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS paused_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_paused_until ON conversations(paused_until)
  WHERE paused_until IS NOT NULL;
