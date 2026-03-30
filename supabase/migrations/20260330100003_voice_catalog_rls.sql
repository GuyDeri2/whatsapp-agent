-- Enable RLS on voice_catalog and add read access for authenticated users.
-- voice_catalog is a shared read-only resource — any logged-in user can browse
-- available voices. Writes are restricted to service role (admin seeding only).

-- 1. Enable RLS
ALTER TABLE voice_catalog ENABLE ROW LEVEL SECURITY;

-- 2. Service role — full access (matches project convention)
CREATE POLICY "Service role full access on voice_catalog"
  ON voice_catalog FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 3. Authenticated users can browse the voice catalog
CREATE POLICY "Authenticated users can read voice_catalog"
  ON voice_catalog FOR SELECT
  USING (auth.role() = 'authenticated');
