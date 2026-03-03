# Backend Memory

## API Route Patterns

- All API routes validate user session via `createServerClient` from `@supabase/ssr`
- Tenant ownership verification: always check `tenants.id = tenantId AND user_id = auth.uid()`
- Error responses: `NextResponse.json({ error: '...' }, { status: 4xx/5xx })`
- Success responses: `NextResponse.json({ data: ... })`

## DeepSeek API

- Client: `new OpenAI({ apiKey: DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' })`
- Model: `deepseek-chat`
- JSON output: `response_format: { type: 'json_object' }` — wraps arrays in object, parse accordingly
- Max tokens: 500 for replies, 1500 for learning, 2000 for synthesis

## Supabase Patterns

- Service role client: `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` — only in session-manager
- Always handle `{ data, error }` from Supabase — check error before using data
- Upsert pattern: `{ onConflict: 'tenant_id,phone_number', ignoreDuplicates: false }`

## Session Manager Integration

- Session manager runs on `http://localhost:3001` (or env PORT)
- Actions: start, stop, restart, status — via `GET /sessions/:tenantId/:action`
- Internal auth via `INTERNAL_API_KEY` header

## Phone Number Handling

- WhatsApp JID format: `972501234567@s.whatsapp.net`
- Always strip `@s.whatsapp.net` to get phone number
- Israeli numbers: `972` prefix (international), `0` prefix (local) — handle both

## Positive Pattern (2026-02-27)
[Score: 8/10] Always include pagination parameters (limit, offset) when implementing sorted message endpoints to handle large conversation histories efficiently.

## Positive Pattern (2026-02-27)
[Score: 8/10] For Supabase upsert operations targeting specific columns like 'contact_name' on conflict, explicitly check the 'onConflict' behavior or use a select-then-update/insert pattern for clarity and reliability.

## Positive Pattern (2026-02-27)
[Score: 8/10] When investigating sync bugs, always start by verifying the actual data exists in the database before analyzing code paths. Include specific test queries to check for the problematic message mentioned in the bug report.

## Positive Pattern (2026-03-01)
[Score: 7/10] Always check existing API routes before proposing new ones; ensure conflict targets in upsert operations match the actual table constraints.

## Positive Pattern (2026-03-02)
[Score: 8/10] WhatsApp Web hierarchy is: saved contact name → push name → phone number (verified name is for business accounts only). Always validate JID format before extracting phone numbers.