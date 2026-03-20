-- ============================================================
-- Optimization: conversations with last message in ONE query
-- ============================================================

-- 1. Fix messages RLS policy — use tenant_id directly (avoid join)
--    Previously: conversation_id IN (SELECT c.id FROM conversations JOIN tenants ...)
--    Now:        tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
DROP POLICY IF EXISTS "Users can read own tenant messages" ON messages;
CREATE POLICY "Users can read own tenant messages"
  ON messages FOR SELECT
  USING (
    tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
  );

-- 2. RPC: fetch conversations + last message in a single round-trip
--    Uses LATERAL JOIN to get the most recent message per conversation
--    without a separate query from the client.
CREATE OR REPLACE FUNCTION get_conversations_with_preview(p_tenant_id uuid, p_limit int DEFAULT 50)
RETURNS TABLE (
  id              uuid,
  tenant_id       uuid,
  phone_number    text,
  contact_name    text,
  is_group        boolean,
  is_paused       boolean,
  updated_at      timestamptz,
  profile_picture_url text,
  last_message    text,
  last_media_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.tenant_id,
    c.phone_number,
    c.contact_name,
    c.is_group,
    c.is_paused,
    c.updated_at,
    c.profile_picture_url,
    m.content   AS last_message,
    m.media_type AS last_media_type
  FROM conversations c
  LEFT JOIN LATERAL (
    SELECT content, media_type
    FROM messages
    WHERE conversation_id = c.id
    ORDER BY created_at DESC
    LIMIT 1
  ) m ON true
  WHERE c.tenant_id = p_tenant_id
  ORDER BY c.updated_at DESC
  LIMIT p_limit;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_conversations_with_preview(uuid, int) TO authenticated;
