-- Migration: Add setup_completed column to tenants
-- Author: Database Agent
-- Date: 2026-03-22

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS setup_completed boolean DEFAULT false;

-- Rollback (manual, for reference only):
-- ALTER TABLE tenants DROP COLUMN IF EXISTS setup_completed;
