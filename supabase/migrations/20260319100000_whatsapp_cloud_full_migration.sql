-- Migration: WhatsApp Cloud API — message deduplication & webhook lookup index
-- Author: Database Agent
-- Date: 2026-03-19
-- Depends on: 20260318162310_add_whatsapp_cloud_config.sql

-- ── Forward migration ──────────────────────────────────────────

-- 1. Add message_id column to messages table
--    This stores the Meta webhook message ID (wamid.*) for deduplication.
--    Nullable because existing messages (from Baileys era) won't have one.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_id text;

-- 2. Partial unique index on message_id — only for non-null values
--    Prevents duplicate webhook deliveries from Meta while allowing
--    old messages without a message_id to coexist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_message_id_unique
    ON messages (message_id)
    WHERE message_id IS NOT NULL;

-- 3. Index on whatsapp_cloud_config(phone_number_id)
--    The webhook handler looks up the tenant by phone_number_id on every
--    incoming message. This index makes that lookup fast.
CREATE INDEX IF NOT EXISTS idx_whatsapp_cloud_config_phone_number_id
    ON whatsapp_cloud_config (phone_number_id);

-- 4. Verify whatsapp_cloud_config structure (assertion comments)
--    The table was created in 20260318162310 with:
--      - id uuid PK
--      - tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, UNIQUE
--      - access_token text NOT NULL
--      - phone_number_id text NOT NULL
--      - waba_id text NOT NULL
--      - webhook_verify_token text NOT NULL
--      - created_at timestamptz
--      - updated_at timestamptz (auto-updated via trigger)
--      - RLS enabled with service_role + tenant_owner policies
--      - Index on tenant_id
--    No structural changes needed — table is correct for Cloud API usage.

-- ── Rollback (manual, for reference only) ─────────────────────
-- DROP INDEX IF EXISTS idx_whatsapp_cloud_config_phone_number_id;
-- DROP INDEX IF EXISTS idx_messages_message_id_unique;
-- ALTER TABLE messages DROP COLUMN IF EXISTS message_id;
