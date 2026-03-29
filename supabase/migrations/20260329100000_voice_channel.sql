-- Voice Channel Integration: Add voice agent support (ElevenLabs + Twilio)
-- This migration only ADDS columns and tables — no existing data is modified.

-- ─── Voice columns on tenants ───────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS elevenlabs_agent_id text,
  ADD COLUMN IF NOT EXISTS elevenlabs_voice_id text,
  ADD COLUMN IF NOT EXISTS voice_settings jsonb DEFAULT '{"stability":0.65,"similarity_boost":0.8,"speed":0.95}',
  ADD COLUMN IF NOT EXISTS voice_first_message text,
  ADD COLUMN IF NOT EXISTS voice_custom_instructions text,
  ADD COLUMN IF NOT EXISTS voice_webhook_secret text DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  ADD COLUMN IF NOT EXISTS twilio_phone_number text,
  ADD COLUMN IF NOT EXISTS voice_enabled boolean DEFAULT false;

-- ─── Voice catalog ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS voice_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  elevenlabs_voice_id text NOT NULL UNIQUE,
  name text NOT NULL,
  display_name_he text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('male', 'female')),
  preview_url text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default Hebrew male voice
INSERT INTO voice_catalog (elevenlabs_voice_id, name, display_name_he, gender, is_default)
VALUES ('7EzWGsX10sAS4c9m9cPf', 'Default Hebrew Male', 'ברירת מחדל — גבר', 'male', true)
ON CONFLICT (elevenlabs_voice_id) DO NOTHING;

-- ─── Call logs ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  elevenlabs_conversation_id text,
  caller_phone text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds int,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('completed', 'missed', 'in_progress', 'failed')),
  summary text,
  transcript jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_logs_tenant_id ON call_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_started_at ON call_logs(started_at);

-- RLS for call_logs
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on call_logs"
  ON call_logs FOR ALL
  USING (true)
  WITH CHECK (true);

-- ─── ElevenLabs KB sync column on knowledge_base ────────────────────────

ALTER TABLE knowledge_base
  ADD COLUMN IF NOT EXISTS elevenlabs_kb_id text;
