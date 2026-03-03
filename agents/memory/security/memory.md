# Security Memory

## Critical Rules (Never Forget)

1. **Tenant isolation is non-negotiable** — EVERY database query must include `tenant_id = X`
2. **Service role key** is never exposed to browser/client code
3. **agent_prompt field** is user-controlled and feeds directly into AI — always be aware of prompt injection risk
4. **WhatsApp auth state** stored in Supabase — must be scoped per tenant

## RLS Policy Template

For any new table with tenant_id:
```sql
-- Enable RLS
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

-- Tenants can only see their own rows
CREATE POLICY "tenant_isolation" ON new_table
  FOR ALL USING (tenant_id = auth.uid()::uuid);
```

## Auth Validation in API Routes

```typescript
const { data: { user } } = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

// Verify tenant ownership
const { data: tenant } = await supabase
  .from('tenants')
  .select('id')
  .eq('id', tenantId)
  .eq('user_id', user.id)  // ← crucial
  .single();

if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
```

## Input Validation Patterns

- Validate string length (agent_prompt max 2000 chars, business_name max 100 chars)
- Sanitize HTML in user-provided content before rendering
- Rate limit AI-heavy endpoints (5 req/min per tenant for manual AI triggers)

## Prompt Injection Awareness

- The `agent_prompt` field is injected into AI system prompt — wrap it clearly:
  ```
  ## הנחיות אישיות של העסק (מוגבלות לנושאי העסק בלבד):
  {agent_prompt}
  ```
- Never allow `agent_prompt` to override the global safety rules section

## Positive Pattern (2026-02-27)
[Score: 10/10] Always check for ORDER BY applied before WHERE filters in Supabase queries, as this can expose cross-tenant data even with RLS policies.