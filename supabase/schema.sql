-- ============================================
-- WhatsApp AI Agent — Multi-Tenant Schema
-- ============================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- -------------------------------------------
-- 1. Tenants (businesses)
-- -------------------------------------------
create table if not exists tenants (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  description   text,            -- what the business does
  products      text,            -- products/services offered
  target_customers text,         -- who the customers are
  agent_mode    text not null default 'learning' check (agent_mode in ('learning', 'active')),
  agent_prompt  text,            -- custom system prompt override (optional)
  whatsapp_connected boolean not null default false,
  whatsapp_phone text,           -- connected phone number
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- -------------------------------------------
-- 2. WhatsApp Sessions (Baileys auth state)
-- -------------------------------------------
create table if not exists whatsapp_sessions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  session_key text not null,     -- key name from Baileys auth state
  session_data jsonb not null,   -- encrypted auth/key data
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(tenant_id, session_key)
);

-- -------------------------------------------
-- 3. Conversations
-- -------------------------------------------
create table if not exists conversations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  phone_number  text not null,
  contact_name  text,            -- name from WhatsApp profile
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(tenant_id, phone_number)
);

-- -------------------------------------------
-- 4. Messages
-- -------------------------------------------
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'owner')),
  content         text not null,
  media_url       text, -- URL to the media file in Supabase Storage
  media_type      text, -- 'image', 'video', 'audio', 'document'
  sender_name     text, -- name of the individual sender (used for group chats)
  is_from_agent   boolean not null default false, -- true if auto-replied by AI
  created_at      timestamptz not null default now()
);

create index idx_messages_conversation on messages(conversation_id, created_at);

-- -------------------------------------------
-- 5. Knowledge Base (per-tenant facts)
-- -------------------------------------------
create table if not exists knowledge_base (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  category    text,              -- e.g. 'product', 'policy', 'faq'
  question    text,
  answer      text not null,
  source      text,              -- 'manual', 'learned', 'imported'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -------------------------------------------
-- 6. Agent Learnings (observed Q&A pairs)
-- -------------------------------------------
create table if not exists agent_learnings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  customer_message text not null,
  owner_reply      text not null,
  confidence       real default 0.0,  -- how well the AI can replicate this
  approved         boolean default false, -- owner-approved for use
  created_at       timestamptz not null default now()
);

-- -------------------------------------------
-- 7. Auto-update updated_at trigger
-- -------------------------------------------
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tenants_updated_at
  before update on tenants
  for each row execute function update_updated_at();

create trigger whatsapp_sessions_updated_at
  before update on whatsapp_sessions
  for each row execute function update_updated_at();

create trigger conversations_updated_at
  before update on conversations
  for each row execute function update_updated_at();

create trigger knowledge_base_updated_at
  before update on knowledge_base
  for each row execute function update_updated_at();

-- -------------------------------------------
-- 8. Row-Level Security
-- -------------------------------------------

-- Tenants
alter table tenants enable row level security;

create policy "Service role full access on tenants"
  on tenants for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Users can manage own tenants"
  on tenants for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- WhatsApp Sessions
alter table whatsapp_sessions enable row level security;

create policy "Service role full access on whatsapp_sessions"
  on whatsapp_sessions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Conversations
alter table conversations enable row level security;

create policy "Service role full access on conversations"
  on conversations for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Users can read own tenant conversations"
  on conversations for select
  using (tenant_id in (select id from tenants where owner_id = auth.uid()));

-- Messages
alter table messages enable row level security;

create policy "Service role full access on messages"
  on messages for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Users can read own tenant messages"
  on messages for select
  using (
    conversation_id in (
      select c.id from conversations c
      join tenants t on c.tenant_id = t.id
      where t.owner_id = auth.uid()
    )
  );

-- Knowledge Base
alter table knowledge_base enable row level security;

create policy "Service role full access on knowledge_base"
  on knowledge_base for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Users can manage own tenant knowledge"
  on knowledge_base for all
  using (tenant_id in (select id from tenants where owner_id = auth.uid()))
  with check (tenant_id in (select id from tenants where owner_id = auth.uid()));

-- Agent Learnings
alter table agent_learnings enable row level security;

create policy "Service role full access on agent_learnings"
  on agent_learnings for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Users can manage own tenant learnings"
  on agent_learnings for all
  using (tenant_id in (select id from tenants where owner_id = auth.uid()))
  with check (tenant_id in (select id from tenants where owner_id = auth.uid()));

-- -------------------------------------------
-- 9. Enable Realtime
-- -------------------------------------------
alter publication supabase_realtime add table tenants;
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table messages;
