ALTER TABLE tenants ADD COLUMN IF NOT EXISTS handoff_collect_email boolean NOT NULL DEFAULT false;
