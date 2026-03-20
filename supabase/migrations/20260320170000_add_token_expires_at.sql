-- Migration: Add token_expires_at to whatsapp_cloud_config
-- Tracks when the Meta access token expires so we can refresh before expiry

ALTER TABLE whatsapp_cloud_config
    ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
