-- Encrypted backup of WhatsApp auth credentials.
-- Survives clearAuthState/clearSessionData — used to auto-reconnect after deploys.
-- Only service_role can access (no browser access ever).

CREATE TABLE IF NOT EXISTS whatsapp_creds_backup (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    encrypted_creds jsonb NOT NULL,
    encrypted_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE whatsapp_creds_backup ENABLE ROW LEVEL SECURITY;
