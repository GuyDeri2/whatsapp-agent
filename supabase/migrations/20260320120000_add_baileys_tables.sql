-- Baileys connection support: config table, QR codes table, connection_type column

-- ── baileys_config: stores per-tenant Baileys session metadata ──
CREATE TABLE IF NOT EXISTS baileys_config (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone_number text,
    connected_at timestamptz,
    warmup_until timestamptz,
    last_disconnect_reason text,
    risk_level text DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(tenant_id)
);

ALTER TABLE baileys_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on baileys_config"
    ON baileys_config FOR ALL
    USING (true)
    WITH CHECK (true);

-- ── baileys_qr_codes: temporary QR codes for Realtime subscription ──
CREATE TABLE IF NOT EXISTS baileys_qr_codes (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    qr_data_url text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE baileys_qr_codes ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read their own QR codes
CREATE POLICY "Tenant owners can read their QR codes"
    ON baileys_qr_codes FOR SELECT
    USING (
        tenant_id IN (
            SELECT id FROM tenants WHERE owner_id = auth.uid()
        )
    );

-- Service role can write QR codes
CREATE POLICY "Service role full access on baileys_qr_codes"
    ON baileys_qr_codes FOR ALL
    USING (true)
    WITH CHECK (true);

-- Enable Realtime for QR codes table
ALTER PUBLICATION supabase_realtime ADD TABLE baileys_qr_codes;

-- ── Add connection_type to tenants ──
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tenants' AND column_name = 'connection_type'
    ) THEN
        ALTER TABLE tenants ADD COLUMN connection_type text DEFAULT 'none'
            CHECK (connection_type IN ('none', 'cloud', 'baileys'));
    END IF;
END $$;

-- Set existing connected tenants to 'cloud' connection type
UPDATE tenants
SET connection_type = 'cloud'
WHERE whatsapp_connected = true
  AND connection_type = 'none'
  AND id IN (SELECT tenant_id FROM whatsapp_cloud_config);

-- ── Ensure whatsapp_sessions table exists (for Baileys auth state) ──
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key text NOT NULL,
    value text NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(tenant_id, key)
);

ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on whatsapp_sessions"
    ON whatsapp_sessions FOR ALL
    USING (true)
    WITH CHECK (true);
