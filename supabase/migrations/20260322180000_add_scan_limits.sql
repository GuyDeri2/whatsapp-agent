-- Add website scan rate limiting columns to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS website_scans_used integer DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS website_scans_month text DEFAULT to_char(now(), 'YYYY-MM');
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS website_scans_bonus integer DEFAULT 0;
