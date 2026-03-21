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

## Security Changes — 2026-03-17

### Encrypted Creds Backup
- New `whatsapp_creds_backup` table stores AES-256-GCM encrypted WhatsApp credentials
- Each field (creds + each signal key) encrypted individually with unique random IV per write
- `SESSION_ENCRYPTION_KEY` env var required — backup skipped if not set
- Backup deleted on terminal disconnect states (loggedOut/connectionReplaced) to prevent stale creds

### Webhook Route Deletion (CRITICAL FIX)
- `src/app/api/webhook/route.ts` was deleted — it had a CRITICAL tenant isolation breach:
  - `onConflict: "phone_number"` without `tenant_id` — two tenants with same customer phone would share conversations
  - Used service role key without tenant ownership verification
  - This was legacy pre-multi-tenant code using OpenAI GPT-4 + WhatsApp Cloud API (not Baileys)

### clearAuthState Security Improvement
- BEFORE: `clearAuthState()` deleted ALL rows from `whatsapp_sessions` including LID mappings
- AFTER: preserves `lid_*` and `contacts` rows — only deletes auth/crypto keys
- WHY: LID mappings are expensive to rebuild and not auth-related. Deleting them caused conversation splitting (data integrity issue).

### Anti-Ban Module
- New `antiban.ts` module adds health monitoring — tracks disconnects and failed sends
- Risk scoring (0-100) with 4 levels: low/medium/high/critical
- 403 (Forbidden) disconnect adds 40 points, 401 (LoggedOut) adds 60 points
- Owner alerts when risk escalates — stored in `last_disconnect_reason` field
- Health endpoint: `GET /sessions/:tenantId/health`

### System JID Filtering (Verified Safe)
- Filters Meta probe ranges (1203631XXXX, 1650XXXXXXX) — verified this mimics WhatsApp client behavior
- Also filters: broadcast, newsletter, 0@s.whatsapp.net, 1-3 digit JIDs, support numbers
- Filtering happens BEFORE conversation upsert — no ghost conversations created from system JIDs

## Production Security Hardening — 2026-03-17

Full security audit was performed before production launch. Found 7.5/10 risk score with 3 P0, 4 P1, 5 P2 issues. ALL fixed:

### P0 — OAuth CSRF Vulnerability (CRITICAL)
- **BEFORE**: `src/app/api/oauth/google/route.ts` and `outlook/route.ts` had NO auth check — anyone could initiate OAuth for any tenantId. State parameter was unsigned base64, attacker could forge tenantId to link their Google/Outlook account to victim's tenant.
- **AFTER**: Both initiation routes now require `getUser()` auth + tenant ownership verification (`owner_id = user.id`). State is HMAC-SHA256 signed: `${tenantId}:${userId}:${ts}` with `OAUTH_STATE_SECRET` (fallback: `SUPABASE_SERVICE_ROLE_KEY`).
- **Callback routes**: Verify HMAC signature + 10-minute expiry to prevent replay attacks.
- **WHY HMAC**: Prevents state tampering — attacker can't forge a valid signature without the server secret.

### P1 — getSession() vs getUser()
- **BEFORE**: `messages/route.ts` and `contacts/route.ts` used `getSession()` which reads JWT from cookie without server validation — session could be expired/revoked but still accepted.
- **AFTER**: All routes use `getUser()` which validates with Supabase auth server on every request.
- **Files changed**: `src/app/api/tenants/[tenantId]/messages/route.ts`, `src/app/api/tenants/[tenantId]/contacts/route.ts` (GET, POST, DELETE)

### P1 — Sessions GET Missing Auth
- **BEFORE**: `src/app/api/sessions/[tenantId]/[action]/route.ts` GET handler had auth but no tenant ownership check — any authenticated user could check any tenant's session status.
- **AFTER**: Added tenant ownership verification (same pattern as POST handler).

### P2 — Calendly Webhook Timing Attack
- **BEFORE**: `src/app/api/webhooks/calendly/route.ts` used `===` for HMAC comparison — vulnerable to timing attacks that could leak signature bytes.
- **AFTER**: Uses `crypto.timingSafeEqual()` with Buffer comparison + length check.

### P2 — SSRF in Lead Export
- **BEFORE**: `src/app/api/tenants/[tenantId]/leads/export/route.ts` fetched any URL from `tenant.lead_webhook_url` — could be used to probe internal network (10.x, 172.16-31.x, 192.168.x, 127.x, etc.).
- **AFTER**: Blocks private IP ranges: localhost, 0.0.0.0, ::1, 127.x, 10.x, 192.168.x, 172.16-31.x, 169.254.x.

### P2 — SESSION_ENCRYPTION_KEY Optional
- **BEFORE**: `session-store.ts` silently skipped creds backup when `SESSION_ENCRYPTION_KEY` was missing — no one would notice.
- **AFTER**: Loud startup warning banner + `saveCredsBackup()` throws an error if key is missing (prevents silent failure).

### New Environment Variable
- `OAUTH_STATE_SECRET` — optional, falls back to `SUPABASE_SERVICE_ROLE_KEY`. Dedicated secret is better practice for key rotation.

## Improvement Note (2026-03-14)
[Score: 1/10] For Supabase Realtime implementations, key security checks: 1) All tables must have RLS enabled, 2) Subscriptions must filter by tenant_id, 3) Validate user authentication before establishing connections.

## Improvement Note (2026-03-15)
[Score: 1/10] Contact name display bugs in session-manager are generally functional, not security-critical, unless explicitly involving data leaks or injection; avoid unnecessary deep analysis.

## Improvement Note (2026-03-15)
[Score: 1/10] Security agents should assess task relevance before engaging. For connection issues, focus on authentication, token handling, or API security aspects if applicable, otherwise suggest focusing on other roles.

## Positive Pattern (2026-03-17)
[Score: 9/10] Always include practical steps for obtaining missing credentials (e.g., 'Go to Google Cloud Console → APIs & Services → Credentials') when identifying missing OAuth configuration.

## Anti-Ban Security Improvements — 2026-03-22
- Read receipts with 1-3s gaussian delay (prevents bot detection)
- Risk score monitoring: 0-100 scale, automatic decay, alerts at critical levels
- Identical message blocking: same content to 3+ conversations in 30 min → blocked
- markOnlineOnConnect: false — stealth connect prevents 24/7 online indicator