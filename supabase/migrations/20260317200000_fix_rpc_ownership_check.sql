-- Fix: add ownership check to get_conversations_with_preview
-- Previously any authenticated user could read any tenant's conversations.
-- Now the function verifies the caller owns the tenant.

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
    AND p_tenant_id IN (SELECT t.id FROM tenants t WHERE t.owner_id = auth.uid())
  ORDER BY c.updated_at DESC
  LIMIT p_limit;
$$;
