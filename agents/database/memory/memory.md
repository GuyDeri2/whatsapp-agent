# Database Agent Memory

> Auto-updated after each run. Read this before starting any task.

## ✅ Successful Patterns
<!-- [date] What worked and why -->

## ❌ Mistakes to Avoid
<!-- [date] What failed, root cause, how to prevent -->

## 💡 Lessons Learned
- [2026-03-13] RLS must be enabled with `ALTER TABLE x ENABLE ROW LEVEL SECURITY` AND a policy must be created — enabling alone does nothing.
- [2026-03-13] Use CHECK constraints (not PostgreSQL enums) for status columns — easier to add new values without migrations.
- [2026-03-13] Always use `ON DELETE CASCADE` for child tables referencing `tenants(id)` — prevents orphaned rows and simplifies cleanup.
- [2026-03-13] Adding a NOT NULL column to a populated table requires: add nullable → backfill → add constraint.

## 🎯 Project Preferences
- [2026-03-13] Migration files go in `supabase/migrations/` with timestamp prefix
- [2026-03-13] Phone numbers stored without `+`, international format: `972501234567`
- [2026-03-13] Service role key bypasses RLS — never expose to browser
- [2026-03-13] Supabase Realtime is active on `messages` and `conversations` tables — must maintain this for ChatTab live updates

## Coordination Rules — 2026-03-13
- You work in parallel with Frontend and Backend agents
- YOUR files: `supabase/migrations/` (new files ONLY) — never edit existing migration files
- When creating migration files, check existing timestamps to pick a later one

## Lessons — 2026-03-13
- Always use `CREATE INDEX IF NOT EXISTS` in migrations — safe to re-run
- Composite indexes needed: (tenant_id, updated_at DESC) on conversations, (tenant_id, conversation_id, created_at) on messages
- Check existing migration files for timestamp conflicts before naming new ones
- Migration naming: use timestamp format YYYYMMDDHHMMSS, check existing files first
- After creating migration file, remind user to run `npx supabase db push`

## Positive Pattern (2026-03-15)
[Score: 9/10] This agent should remember that when running Supabase migrations, it's helpful to suggest verification queries (e.g., SELECT * FROM meetings LIMIT 1) to confirm column additions, especially for team members who might be less familiar with database tools.

## Improvement Note (2026-03-17)
[Score: 2/10] For credential persistence investigations, start with direct database queries checking timestamps, registered flags, and backup consistency.

## Full Audit — 2026-03-22

### Findings & Fixes
1. **CRITICAL: `lid_phone_map` RLS was `USING(true)`** — any authenticated user could read/write all LID mappings. Fixed to service_role only.
2. **Missing index: `conversations(tenant_id, is_paused, is_group)`** — partial index added for the unanswered-reminder cron query pattern (runs every 5 min).
3. **Missing index: `agent_learnings(tenant_id)`** — table exists from init but had no index. Added for safety.
4. **Missing index: `whatsapp_cloud_config(token_expires_at)`** — partial index for token refresh cron query.
5. **Inefficient query: `learning-engine.ts`** used `conversations.tenant_id` filter via JOIN instead of `messages.tenant_id` directly (which is indexed). Fixed.
6. **`checkContactFilter` fetches all rules** — intentional due to fuzzy phone matching (local vs international). Not fixable without normalizing all stored phone numbers.
7. **N+1 in unanswered-reminder cron** — each paused conversation queries `messages` separately. Low impact (cron, not user-facing). Could batch but complexity not worth it.
8. **`agent_learnings` table is unused** — no code references it. Learning engine writes to `knowledge_base`. Consider dropping in future cleanup.
9. **`calendar_integrations`, `availability_rules`, `meeting_settings`, `meetings`** — no service_role policy but service_role bypasses RLS anyway. Consistent but implicit.

### Lessons
- [2026-03-22] Always audit RLS policies with `USING(true)` — they grant access to ALL authenticated users, not just service_role.
- [2026-03-22] Partial indexes (`WHERE condition`) are excellent for cron queries that filter on boolean flags.
- [2026-03-22] When a column like `tenant_id` exists on both parent and child tables, always filter on the child table directly (avoids unnecessary JOINs).
- [2026-03-22] Phone number normalization inconsistency prevents DB-level exact matching. Convention exists but enforcement is application-side only.
- [2026-03-22] UNIQUE constraints create implicit indexes — no need to add explicit indexes on the same column set.

## Purchase Flows Migration — 2026-03-22

### What was done
- Created `purchase_flows` table with UNIQUE constraint on `tenant_id` (one flow per tenant)
- JSONB columns for `products` and `required_fields` — flexible schema for e-commerce data
- RLS: SELECT for tenant owner only, INSERT/UPDATE/DELETE for service_role only (no explicit policy needed)
- Migration applied successfully via `npx supabase db push`

### Lessons
- [2026-03-22] The `tenants` table uses `owner_id` (NOT `user_id`) — always check existing migrations for the correct column name before writing RLS policies.
- [2026-03-22] For tables where only admins write but owners read: use a single SELECT RLS policy. Service role bypasses RLS for write operations.
- [2026-03-22] JSONB with DEFAULT '[]'::jsonb is good for flexible array-of-objects schemas (products, required fields) — avoids extra junction tables.