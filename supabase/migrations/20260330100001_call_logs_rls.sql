-- Fix call_logs RLS policies
-- The original migration enabled RLS but only added an overly permissive
-- "Service role full access" policy with USING (true) — no role check.
-- This migration drops that policy and adds proper ones.

-- 1. Ensure RLS is enabled (idempotent)
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

-- 2. Drop the broken service-role policy (USING true, no role check)
DROP POLICY IF EXISTS "Service role full access on call_logs" ON call_logs;

-- 3. Service role — full access (matches pattern from init migration)
CREATE POLICY "Service role full access on call_logs"
  ON call_logs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 4. Authenticated users can SELECT call_logs for tenants they own
CREATE POLICY "Users can read own tenant call_logs"
  ON call_logs FOR SELECT
  USING (tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid()));

-- 5. Authenticated users can INSERT call_logs for tenants they own
CREATE POLICY "Users can insert own tenant call_logs"
  ON call_logs FOR INSERT
  WITH CHECK (tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid()));
