-- Store last WhatsApp disconnect reason per tenant for debugging
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS last_disconnect_reason text;
