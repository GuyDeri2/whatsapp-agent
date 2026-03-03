-- Migration to add message statuses to WhatsApp agent
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status text CHECK (status IN ('sent', 'delivered', 'read', 'failed'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS wa_message_id text;

-- Add index to fast lookup messages by wa_message_id
CREATE INDEX IF NOT EXISTS idx_messages_wa_message_id ON messages(wa_message_id);
