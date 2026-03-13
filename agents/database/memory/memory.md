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
