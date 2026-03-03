-- Add tenant_id to messages table for efficient realtime filtering
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- Backfill existing messages with their tenant_id from conversations
UPDATE messages m
SET tenant_id = c.tenant_id
FROM conversations c
WHERE m.conversation_id = c.id
AND m.tenant_id IS NULL;

-- Make it NOT NULL after backfill
ALTER TABLE messages ALTER COLUMN tenant_id SET NOT NULL;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id);
