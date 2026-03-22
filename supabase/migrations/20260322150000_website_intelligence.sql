-- Add website intelligence columns to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS website_url text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS website_last_crawled_at timestamptz;
