-- Add is_saved_contact to conversations to track if a number is in the phonebook
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_saved_contact BOOLEAN NOT NULL DEFAULT false;

-- Add agent_respond_to_saved_contacts to tenants to toggle responding to saved contacts
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS agent_respond_to_saved_contacts BOOLEAN NOT NULL DEFAULT true;
