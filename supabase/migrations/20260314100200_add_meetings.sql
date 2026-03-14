CREATE TABLE IF NOT EXISTS meetings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id     uuid REFERENCES conversations(id) ON DELETE SET NULL,
  calendar_event_id   text,                -- external calendar event ID (after creation)
  customer_name       text,
  customer_phone      text NOT NULL,
  start_time          timestamptz NOT NULL,
  end_time            timestamptz NOT NULL,
  status              text NOT NULL DEFAULT 'confirmed'
                      CHECK (status IN ('confirmed', 'cancelled', 'rescheduled')),
  meeting_type        text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_overlap UNIQUE NULLS NOT DISTINCT (tenant_id, start_time, status)
  -- Note: this is a soft constraint; overlap is enforced in application logic
);

-- Drop the soft constraint since it's too strict with nulls
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS no_overlap;

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON meetings
  FOR ALL USING (tenant_id IN (SELECT id FROM tenants WHERE owner_id = auth.uid()));
CREATE INDEX idx_meetings_tenant_start ON meetings(tenant_id, start_time);
CREATE INDEX idx_meetings_tenant_status ON meetings(tenant_id, status);
CREATE INDEX idx_meetings_conversation ON meetings(conversation_id);
