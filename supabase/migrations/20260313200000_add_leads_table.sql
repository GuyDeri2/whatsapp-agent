-- Migration: Add leads table for persisting captured leads from WhatsApp handoffs
-- Every time the AI fires a handoff ([PAUSE] marker), a lead is saved here.

CREATE TABLE IF NOT EXISTS leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  name             text,
  phone            text NOT NULL,
  email            text,
  summary          text,
  created_at       timestamptz DEFAULT now()
);

-- Enable RLS (mandatory for tenant-scoped tables)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policy (Next.js SSR client uses JWT)
CREATE POLICY "tenant_isolation" ON leads
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid())
  );

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_leads_tenant_created ON leads(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_conversation ON leads(conversation_id);
