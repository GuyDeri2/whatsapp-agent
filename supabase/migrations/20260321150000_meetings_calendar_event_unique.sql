-- Add unique constraint on (tenant_id, calendar_event_id) for proper upsert behavior.
-- Without this, Calendly webhook retries create duplicate meeting rows.

CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_tenant_calendar_event
ON meetings(tenant_id, calendar_event_id)
WHERE calendar_event_id IS NOT NULL;
