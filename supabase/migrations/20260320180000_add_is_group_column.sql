-- Add missing is_group and profile_picture_url columns to conversations table.
-- These columns are referenced by code and the get_conversations_with_preview RPC
-- but were never created, causing INSERT failures (conversations not appearing).

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS profile_picture_url text;
