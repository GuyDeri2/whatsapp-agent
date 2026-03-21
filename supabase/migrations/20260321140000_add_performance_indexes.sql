-- Performance indexes for frequently queried columns

-- contact_rules: queried on every incoming message when filter mode is active
CREATE INDEX IF NOT EXISTS idx_contact_rules_tenant
ON contact_rules(tenant_id);

-- whatsapp_cloud_config: webhook verification token lookup
CREATE INDEX IF NOT EXISTS idx_whatsapp_cloud_config_verify_token
ON whatsapp_cloud_config(webhook_verify_token);
