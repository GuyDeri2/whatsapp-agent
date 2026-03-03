# Security Skills & Patterns

## Tenant Isolation Checklist

For every new API route, verify:
```
[ ] supabase.auth.getUser() called — user is authenticated
[ ] tenant fetched with .eq('user_id', user.id) — user owns the tenant
[ ] all subsequent queries include .eq('tenant_id', tenant.id)
[ ] RLS policy exists on any new table
[ ] SUPABASE_SERVICE_ROLE_KEY never returned to client
```

---

## RLS Policy Templates

### Standard tenant-scoped policy
```sql
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation"
ON new_table FOR ALL
USING (
  tenant_id IN (
    SELECT id FROM tenants WHERE user_id = auth.uid()
  )
);
```

### Read-only for authenticated users
```sql
CREATE POLICY "Read own data"
ON new_table FOR SELECT
USING (tenant_id IN (SELECT id FROM tenants WHERE user_id = auth.uid()));

CREATE POLICY "Modify own data"
ON new_table FOR INSERT WITH CHECK (
  tenant_id IN (SELECT id FROM tenants WHERE user_id = auth.uid())
);
```

---

## Prompt Injection Prevention

Users control `agent_prompt` — this goes directly into AI system prompts. Risks:
- Instructing the AI to ignore its instructions
- Extracting knowledge base contents
- Impersonating the business to customers

**Mitigations:**
```typescript
function sanitiseAgentPrompt(prompt: string): string {
  // Remove potential injection patterns
  const dangerousPatterns = [
    /ignore previous instructions/gi,
    /system prompt/gi,
    /you are now/gi,
  ]

  let sanitised = prompt
  for (const pattern of dangerousPatterns) {
    sanitised = sanitised.replace(pattern, '[removed]')
  }

  // Length limit
  return sanitised.slice(0, 5000)
}
```

---

## API Security Checklist

```typescript
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // 1. Auth check
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Ownership check
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 3. Input validation
  const body = await req.json()
  if (!body.content || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }
  if (body.content.length > 1000) {
    return NextResponse.json({ error: 'Content too long' }, { status: 400 })
  }

  // 4. Safe operation (tenant_id scoped)
  await supabase.from('messages').insert({ tenant_id: tenant.id, content: body.content })
}
```

---

## Environment Variable Security

| Variable | Allowed in client? | Notes |
|----------|-------------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Yes | Public, safe |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Yes | Public, RLS protects data |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ Never | Server-only, bypasses RLS |
| `DEEPSEEK_API_KEY` | ❌ Never | Expensive if leaked |
| `INTERNAL_API_KEY` | ❌ Never | session-manager ↔ Next.js secret |

---

## Data Minimisation (PDPA / GDPR)

- Log **metadata** not content: `"Message received from +972..."` not the full message
- Do not store WhatsApp media unless explicitly needed
- Phone numbers are PII — never return them in list endpoints without auth
- If offering a delete feature, ensure cascade deletes conversations + messages
