-- Fix: session_data was jsonb but code stores/reads it as text (encrypted or plain JSON strings).
-- jsonb auto-parses on read, breaking the encrypt/decrypt round-trip.
-- Change to text so the stored string is returned as-is.

ALTER TABLE whatsapp_sessions
  ALTER COLUMN session_data TYPE text
  USING session_data::text;
