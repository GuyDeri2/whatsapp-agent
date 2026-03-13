# Database Agent — Skills & Patterns

## 1. Adding a New Table (Full Checklist)

```sql
-- Step 1: Create table with tenant_id + cascade
CREATE TABLE my_feature (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- ... feature columns ...
  created_at  timestamptz DEFAULT now()
);

-- Step 2: Enable RLS
ALTER TABLE my_feature ENABLE ROW LEVEL SECURITY;

-- Step 3: RLS policy (dashboard/Next.js SSR access)
CREATE POLICY "tenant_isolation" ON my_feature
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE user_id = auth.uid())
  );

-- Step 4: Indexes
CREATE INDEX idx_my_feature_tenant ON my_feature(tenant_id);
```

---

## 2. Adding Columns to Existing Tables

```sql
-- Safe: adding nullable column (no migration risk)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS new_field text;

-- Safe: adding with default (existing rows get default)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- Risky: adding NOT NULL without default → fails on existing rows
-- Fix: add nullable first, backfill, then add constraint
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS critical_field text;
UPDATE tenants SET critical_field = 'default_value' WHERE critical_field IS NULL;
ALTER TABLE tenants ALTER COLUMN critical_field SET NOT NULL;
```

---

## 3. RLS Patterns

### Standard tenant isolation (auth via JWT)
```sql
CREATE POLICY "tenant_isolation" ON table_name
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE user_id = auth.uid())
  );
```

### Read-only public access (e.g. knowledge base items without auth)
```sql
CREATE POLICY "public_read" ON knowledge_base
  FOR SELECT USING (true);
```

### Insert only for authenticated users
```sql
CREATE POLICY "auth_insert" ON table_name
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT id FROM tenants WHERE user_id = auth.uid())
  );
```

---

## 4. Enum-like Constraints

Use CHECK constraints instead of PostgreSQL enums (easier to extend):
```sql
-- Preferred
agent_mode text CHECK (agent_mode IN ('learning', 'active', 'paused'))

-- Avoid (hard to add values)
agent_mode agent_mode_enum
```

---

## 5. Supabase Realtime Setup

Enable Realtime on a table (for live chat updates):
```sql
-- In Supabase dashboard or migration:
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
```

Client-side subscription (already used in ChatTab.tsx):
```typescript
supabase
  .channel('messages')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'messages',
    filter: `conversation_id=eq.${conversationId}`
  }, handler)
  .subscribe();
```

---

## 6. Query Optimisation

```sql
-- Check slow queries with EXPLAIN ANALYZE
EXPLAIN ANALYZE
SELECT * FROM messages
WHERE conversation_id = 'xxx'
ORDER BY created_at DESC
LIMIT 50;

-- Common index patterns for this project
CREATE INDEX idx_messages_conv_created ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_conversations_tenant_updated ON conversations(tenant_id, updated_at DESC);
CREATE INDEX idx_knowledge_base_tenant_cat ON knowledge_base(tenant_id, category);
```

---

## 7. Migration File Template

```sql
-- supabase/migrations/<timestamp>_<description>.sql
-- Migration: <human-readable description>
-- Author: Database Agent
-- Date: <date>

-- ── Forward migration ──────────────────────────────────────────

-- [SQL here]

-- ── Rollback (manual, for reference only) ─────────────────────
-- DROP TABLE IF EXISTS my_feature;
```

---

## 8. TypeScript Types Regeneration

After any schema change, regenerate types:
```bash
npx supabase gen types typescript \
  --project-id <project-id> \
  > src/types/database.ts
```

Or via CLI from project root:
```bash
npx supabase gen types typescript --local > src/types/database.ts
```

---

## 9. Phone Number Storage Convention

- Always store WITHOUT `+`, in international format: `972501234567`
- WhatsApp JID: `972501234567@s.whatsapp.net`
- Index phone columns used in lookups:
  ```sql
  CREATE INDEX idx_contact_rules_phone ON contact_rules(tenant_id, phone_number);
  ```

---

## 10. Soft Delete Pattern (when needed)

```sql
-- Add soft delete columns
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Update RLS to exclude soft-deleted rows
DROP POLICY IF EXISTS "tenant_isolation" ON conversations;
CREATE POLICY "tenant_isolation" ON conversations
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE user_id = auth.uid())
    AND deleted_at IS NULL
  );

-- Index for performance
CREATE INDEX idx_conversations_not_deleted ON conversations(tenant_id) WHERE deleted_at IS NULL;
```

---

## Supabase CLI Workflows

### Full migration workflow
```bash
# 1. Create the migration file
npx supabase migration new add_my_feature

# 2. Edit the generated file in supabase/migrations/
# 3. Push to production
npx supabase db push

# 4. Verify it applied
npx supabase migration list

# 5. Regenerate TypeScript types
npx supabase gen types typescript \
  --project-id $(grep project_id supabase/config.toml | cut -d'"' -f2) \
  > src/types/database.ts
```

### Check which migrations are pending
```bash
npx supabase migration list
# Output shows: applied ✓ or pending ○
```

### Verify an index was created
```bash
npx supabase db execute --file - <<'EOF'
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('messages', 'conversations', 'knowledge_base', 'contact_rules')
ORDER BY tablename, indexname;
EOF
```

### EXPLAIN ANALYZE via CLI
```bash
npx supabase db execute --file - <<'EOF'
EXPLAIN ANALYZE
SELECT * FROM messages
WHERE tenant_id = 'some-uuid'
ORDER BY created_at DESC
LIMIT 100;
EOF
```
