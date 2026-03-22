-- Backfill: Mark all existing tenants as setup_completed = true
-- New tenants will default to false and see the onboarding wizard
UPDATE tenants SET setup_completed = true WHERE setup_completed = false;
