-- Schema audit fixes (2026-03-21)

-- 1. CRITICAL: agent_mode CHECK constraint missing 'paused'
-- New tenants are created with agent_mode='paused' but constraint only allows 'learning'/'active'
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_agent_mode_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_agent_mode_check
  CHECK (agent_mode IN ('learning', 'active', 'paused'));

-- 2. CRITICAL: whatsapp_creds_backup has RLS enabled but zero policies (complete lockout)
CREATE POLICY "service_role_full_access" ON whatsapp_creds_backup
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 3. HIGH: baileys_config RLS policy grants access to ALL authenticated users
-- Drop the overly permissive policy and replace with service_role only
DROP POLICY IF EXISTS "Service role full access on baileys_config" ON baileys_config;
CREATE POLICY "service_role_full_access" ON baileys_config
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Also fix baileys_qr_codes if it has the same issue
DROP POLICY IF EXISTS "Service role full access on baileys_qr_codes" ON baileys_qr_codes;
CREATE POLICY "service_role_full_access" ON baileys_qr_codes
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 4. LOW: Add NOT NULL to timestamp columns that should never be null
ALTER TABLE whatsapp_cloud_config ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE whatsapp_cloud_config ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE leads ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE baileys_config ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE baileys_config ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE baileys_qr_codes ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE baileys_qr_codes ALTER COLUMN updated_at SET NOT NULL;

-- 5. LOW: Add updated_at trigger for baileys_config
CREATE TRIGGER update_baileys_config_updated_at
  BEFORE UPDATE ON baileys_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
