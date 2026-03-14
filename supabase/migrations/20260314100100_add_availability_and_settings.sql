-- Weekly availability windows (multiple rows per tenant per day)
CREATE TABLE IF NOT EXISTS availability_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day_of_week   int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, 6=Sat
  start_time    time NOT NULL,  -- e.g. '09:00'
  end_time      time NOT NULL,  -- e.g. '17:00'
  CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

ALTER TABLE availability_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON availability_rules
  FOR ALL USING (tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid()));
CREATE INDEX idx_availability_rules_tenant ON availability_rules(tenant_id, day_of_week);

-- Meeting settings (one row per tenant)
CREATE TABLE IF NOT EXISTS meeting_settings (
  tenant_id             uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  duration_minutes      int NOT NULL DEFAULT 30,
  buffer_minutes        int NOT NULL DEFAULT 0,
  timezone              text NOT NULL DEFAULT 'Asia/Jerusalem',
  booking_notice_hours  int NOT NULL DEFAULT 2,   -- min notice required
  booking_window_days   int NOT NULL DEFAULT 14,  -- how far ahead can book
  meeting_type_label    text DEFAULT 'פגישה',     -- shown in calendar event
  scheduling_enabled    boolean NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE meeting_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON meeting_settings
  FOR ALL USING (tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid()));
