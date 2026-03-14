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

## Positive Pattern (2026-02-27)
[Score: 9/10] Always verify that all data access operations (especially upserts/updates) include tenant_id filters, and that API routes validate tenant ownership against the authenticated user's permissions.

## Positive Pattern (2026-02-27)
[Score: 7/10] When reviewing sync bugs, consider if missing RLS policies could prevent data insertion, but prioritize this after verifying the data flow and race conditions. Connect security findings directly to the observed symptoms.

## Positive Pattern (2026-03-01)
[Score: 8/10] Always validate assumptions about database schema before proposing security fixes; leverage Supabase RLS fully before adding client-side validation.

## Positive Pattern (2026-03-02)
[Score: 9/10] Always verify tenant ownership at both API route level AND database RLS level for defense in depth. Session data must be strictly tenant-isolated.

## Coordination Rules — 2026-03-13
- Run in parallel with other agents as a reviewer — flag issues without blocking them
- Focus review on: tenant isolation, RLS policies, auth checks in API routes, prompt injection

## Lessons — 2026-03-13
- Every new API route must verify tenant ownership before any DB operation
- Service role key bypasses RLS — only use in session-manager and API routes, never browser
- agent_prompt is user-controlled — treat as untrusted input when fed to AI (prompt injection risk)
- Contact filter cache must be invalidated when rules change — otherwise stale whitelist/blacklist

## Improvement Note (2026-03-14)
[Score: 1/10] For Supabase Realtime implementations, key security checks: 1) All tables must have RLS enabled, 2) Subscriptions must filter by tenant_id, 3) Validate user authentication before establishing connections.