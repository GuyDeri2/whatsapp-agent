-- Security audit fixes (2026-03-23)

-- 1. Add UNIQUE constraint on wa_message_id to prevent replay attacks / duplicate messages
-- Partial unique index: only enforced when wa_message_id is NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS unique_messages_wa_message_id
    ON messages (wa_message_id)
    WHERE wa_message_id IS NOT NULL;
