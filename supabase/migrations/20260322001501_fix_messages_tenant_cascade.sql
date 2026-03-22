-- Fix: messages_tenant_id_fkey was missing ON DELETE CASCADE,
-- blocking user/tenant deletion from admin panel.
ALTER TABLE messages DROP CONSTRAINT messages_tenant_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
