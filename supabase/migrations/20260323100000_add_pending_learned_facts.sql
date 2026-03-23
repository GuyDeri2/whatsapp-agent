-- Add pending_learned_facts column to tenants table
-- Stores an array of objects: [{ "fact": "...", "learned_at": "..." }]
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS pending_learned_facts jsonb DEFAULT '[]'::jsonb;
