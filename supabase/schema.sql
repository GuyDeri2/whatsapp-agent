-- ============================================
-- WhatsApp AI Agent — Supabase Schema
-- ============================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- -------------------------------------------
-- 1. Conversations
-- -------------------------------------------
create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  phone_number text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Auto-update updated_at on row change
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger conversations_updated_at
  before update on conversations
  for each row execute function update_updated_at();

-- -------------------------------------------
-- 2. Messages
-- -------------------------------------------
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);

create index idx_messages_conversation on messages(conversation_id, created_at);

-- -------------------------------------------
-- 3. Row-Level Security
-- -------------------------------------------

-- Conversations
alter table conversations enable row level security;

create policy "Service role full access on conversations"
  on conversations for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Authenticated users can read conversations"
  on conversations for select
  using (auth.role() = 'authenticated');

-- Messages
alter table messages enable row level security;

create policy "Service role full access on messages"
  on messages for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Authenticated users can read messages"
  on messages for select
  using (auth.role() = 'authenticated');

-- -------------------------------------------
-- 4. Enable Realtime
-- -------------------------------------------
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table messages;
