-- ── Calendar system improvements ────────────────────────────────────────────
-- Race condition protection: only one confirmed meeting per time slot per tenant
CREATE UNIQUE INDEX IF NOT EXISTS meetings_tenant_confirmed_slot
  ON meetings(tenant_id, start_time)
  WHERE status = 'confirmed';

-- Calendar provider used when booking (google | outlook | calendly | null)
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS calendar_provider text;

-- Reminder tracking (prevents double-sends)
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reminder_day_sent  boolean NOT NULL DEFAULT false;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reminder_2h_sent   boolean NOT NULL DEFAULT false;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS owner_reminder_2h_sent boolean NOT NULL DEFAULT false;

-- Cancellation confirmation state: when a customer says "cancel", we store
-- which meeting they want to cancel and wait for their "yes" confirmation
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS pending_cancellation_meeting_id uuid
  REFERENCES meetings(id) ON DELETE SET NULL;

-- Timezone per tenant (used for slot display + notifications)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Jerusalem';
