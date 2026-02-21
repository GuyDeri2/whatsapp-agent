-- Add contact filtering to the WhatsApp Agent platform
-- Agent can respond to: all contacts, whitelist only, or all except blacklist

-- 1. Add agent_filter_mode to tenants
alter table tenants add column if not exists agent_filter_mode text not null default 'all'
  check (agent_filter_mode in ('all', 'whitelist', 'blacklist'));

-- 2. Contact rules table
create table if not exists contact_rules (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  phone_number  text not null,
  contact_name  text,
  rule_type     text not null check (rule_type in ('allow', 'block')),
  created_at    timestamptz not null default now(),
  unique(tenant_id, phone_number)
);

-- RLS
alter table contact_rules enable row level security;

create policy "Service role full access on contact_rules"
  on contact_rules for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Users can manage own tenant contact_rules"
  on contact_rules for all
  using (tenant_id in (select id from tenants where owner_id = auth.uid()))
  with check (tenant_id in (select id from tenants where owner_id = auth.uid()));
