-- Migration: Add WhatsApp Cloud API configuration table
-- Author: Database Agent
-- Date: 2026-03-18

-- ── Forward migration ──────────────────────────────────────────

-- 1. Create new whatsapp_cloud_config table
CREATE TABLE IF NOT EXISTS whatsapp_cloud_config (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    access_token text NOT NULL,
    phone_number_id text NOT NULL,
    waba_id text NOT NULL,
    webhook_verify_token text NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(tenant_id) -- One config per tenant
);

-- 2. Enable RLS
ALTER TABLE whatsapp_cloud_config ENABLE ROW LEVEL SECURITY;

-- 3. RLS policies
-- Service role full access (session-manager, Next.js API routes)
CREATE POLICY "service_role_full_access" ON whatsapp_cloud_config
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Tenant owners can read their own config (dashboard access)
CREATE POLICY "tenant_owners_read" ON whatsapp_cloud_config
    FOR SELECT USING (
        tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
    );

-- Tenant owners can update their own config
CREATE POLICY "tenant_owners_update" ON whatsapp_cloud_config
    FOR UPDATE USING (
        tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
    )
    WITH CHECK (
        tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
    );

-- Tenant owners can insert their own config
CREATE POLICY "tenant_owners_insert" ON whatsapp_cloud_config
    FOR INSERT WITH CHECK (
        tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
    );

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_whatsapp_cloud_config_tenant ON whatsapp_cloud_config(tenant_id);

-- 5. Auto-update updated_at trigger
CREATE TRIGGER whatsapp_cloud_config_updated_at
    BEFORE UPDATE ON whatsapp_cloud_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Rollback (manual, for reference only) ─────────────────────
-- DROP TABLE IF EXISTS whatsapp_cloud_config;
