-- Security audit fixes (2026-03-23)

-- 1. Clean up duplicate wa_message_id values (keep the oldest row for each duplicate)
DELETE FROM messages
WHERE id IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY wa_message_id ORDER BY created_at ASC) AS rn
        FROM messages
        WHERE wa_message_id IS NOT NULL
    ) sub
    WHERE rn > 1
);

-- 2. Add UNIQUE constraint on wa_message_id to prevent replay attacks / duplicate messages
-- Partial unique index: only enforced when wa_message_id is NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS unique_messages_wa_message_id
    ON messages (wa_message_id)
    WHERE wa_message_id IS NOT NULL;
