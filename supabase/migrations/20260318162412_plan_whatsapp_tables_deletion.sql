-- Migration: Plan deletion of old WhatsApp tables (whatsapp_sessions, whatsapp_creds_backup)
-- Author: Database Agent
-- Date: 2026-03-18
-- IMPORTANT: This migration should be applied AFTER all data has been migrated to whatsapp_cloud_config
--            and the session-manager has been updated to use the new Cloud API.

-- ── Forward migration ──────────────────────────────────────────

-- 1. First, create backup tables (optional safety measure)
-- Uncomment these lines if you want to preserve the old data before deletion
/*
CREATE TABLE whatsapp_sessions_backup AS SELECT * FROM whatsapp_sessions;
CREATE TABLE whatsapp_creds_backup_backup AS SELECT * FROM whatsapp_creds_backup;
*/

-- 2. Check if migration is safe (no active tenants using old tables)
-- This function can be called manually before applying the DROP statements
CREATE OR REPLACE FUNCTION check_whatsapp_migration_safety()
RETURNS TABLE (
    table_name text,
    table_exists boolean,
    row_count bigint,
    has_tenant_config boolean,
    migration_ready boolean
) AS $$
BEGIN
    RETURN QUERY
    WITH tenant_configs AS (
        SELECT COUNT(*) as config_count FROM whatsapp_cloud_config
    )
    SELECT 
        'whatsapp_sessions' as table_name,
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'whatsapp_sessions') as table_exists,
        (SELECT COUNT(*) FROM whatsapp_sessions) as row_count,
        (SELECT config_count > 0 FROM tenant_configs) as has_tenant_config,
        (SELECT config_count >= (SELECT COUNT(*) FROM whatsapp_sessions WHERE session_key = 'creds') FROM tenant_configs) as migration_ready
    UNION ALL
    SELECT 
        'whatsapp_creds_backup' as table_name,
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'whatsapp_creds_backup') as table_exists,
        (SELECT COUNT(*) FROM whatsapp_creds_backup) as row_count,
        (SELECT config_count > 0 FROM tenant_configs) as has_tenant_config,
        (SELECT config_count >= (SELECT COUNT(*) FROM whatsapp_creds_backup) FROM tenant_configs) as migration_ready;
END;
$$ LANGUAGE plpgsql;

-- 3. Drop tables (COMMENTED OUT FOR SAFETY - UNCOMMENT AFTER VERIFICATION)
-- IMPORTANT: Only uncomment and run these DROP statements after:
--   a) All tenants have migrated to whatsapp_cloud_config
--   b) Session-manager has been updated to use Cloud API
--   c) You have verified no data loss with check_whatsapp_migration_safety()

/*
-- Drop triggers first
DROP TRIGGER IF EXISTS whatsapp_sessions_updated_at ON whatsapp_sessions;

-- Drop tables
DROP TABLE IF EXISTS whatsapp_sessions;
DROP TABLE IF EXISTS whatsapp_creds_backup;
*/

-- 4. Verification query (run after migration to confirm)
-- SELECT * FROM check_whatsapp_migration_safety();

-- ── Rollback (manual, for reference only) ─────────────────────
-- Tables would need to be recreated from backup or original schema
-- No automatic rollback for DROP TABLE operations
