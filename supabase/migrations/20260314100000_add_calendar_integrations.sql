CREATE TABLE IF NOT EXISTS calendar_integrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider          text NOT NULL CHECK (provider IN ('google', 'outlook', 'apple', 'calendly')),
  access_token      text,
  refresh_token     text,
  token_expires_at  timestamptz,
  calendar_id       text,           -- selected calendar ID
  calendar_name     text,           -- display name
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, provider)        -- one integration per provider per tenant
);

ALTER TABLE calendar_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON calendar_integrations
  FOR ALL USING (tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid()));
CREATE INDEX idx_calendar_integrations_tenant ON calendar_integrations(tenant_id);
