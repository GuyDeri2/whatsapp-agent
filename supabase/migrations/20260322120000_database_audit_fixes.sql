-- Migration: Database audit fixes (2026-03-22)
-- Author: Database Agent
-- Fixes: overly permissive RLS, missing indexes, query optimizations

-- ================================================================
-- 1. CRITICAL: Fix lid_phone_map RLS — currently USING(true) allows
--    any authenticated user to read/write all LID mappings.
--    Should be service_role only (only baileys-service writes here).
-- ================================================================

DROP POLICY IF EXISTS "Service role full access on lid_phone_map" ON lid_phone_map;

CREATE POLICY "service_role_only_lid_phone_map" ON lid_phone_map
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ================================================================
-- 2. INDEX: conversations(tenant_id, is_paused, is_group)
--    Used by unanswered-reminder cron (every 5 min) in server.ts:
--    .eq("tenant_id", X).eq("is_paused", true).eq("is_group", false)
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_paused_group
  ON conversations(tenant_id, is_paused, is_group)
  WHERE is_paused = true AND is_group = false;

-- ================================================================
-- 3. INDEX: contact_rules(tenant_id, phone_number)
--    Composite index for the unique constraint lookup path.
--    The unique constraint already creates an index, but an explicit
--    one ensures coverage for SELECT queries too.
--    (unique constraint on tenant_id, phone_number already exists
--     from init migration — so this is already covered. Skip.)
-- ================================================================

-- No action needed — UNIQUE(tenant_id, phone_number) already creates
-- an implicit index. Verified in 20260221172600_add_contact_rules.sql.

-- ================================================================
-- 4. INDEX: agent_learnings(tenant_id) — if table still has data
--    Table exists from init but no code references it anymore.
--    Add index in case legacy data exists and someone queries it.
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_agent_learnings_tenant
  ON agent_learnings(tenant_id);

-- ================================================================
-- 5. INDEX: messages(wa_message_id) for status updates
--    Already exists (20260303213200). Verified — no action needed.
-- ================================================================

-- ================================================================
-- 6. INDEX: whatsapp_cloud_config(token_expires_at)
--    Token refresh cron queries: .or("token_expires_at.is.null,token_expires_at.lt.X")
--    Partial index on non-null values helps the lt filter.
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_whatsapp_cloud_config_token_expires
  ON whatsapp_cloud_config(token_expires_at)
  WHERE token_expires_at IS NOT NULL;

-- ================================================================
-- Rollback (manual, for reference only)
-- ================================================================
-- DROP POLICY IF EXISTS "service_role_only_lid_phone_map" ON lid_phone_map;
-- CREATE POLICY "Service role full access on lid_phone_map" ON lid_phone_map FOR ALL USING (true) WITH CHECK (true);
-- DROP INDEX IF EXISTS idx_conversations_tenant_paused_group;
-- DROP INDEX IF EXISTS idx_agent_learnings_tenant;
-- DROP INDEX IF EXISTS idx_whatsapp_cloud_config_token_expires;
