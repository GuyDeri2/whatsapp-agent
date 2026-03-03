-- Add name_manually_set flag to conversations table
-- When true, contacts.upsert and contacts.update will not overwrite the contact_name
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS name_manually_set BOOLEAN DEFAULT FALSE;
