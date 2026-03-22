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

## Coordination Rules — 2026-03-13
- You work in parallel with Frontend and Database agents — never edit their files
- YOUR files: `session-manager/src/`, `src/app/api/` — Frontend/Database never touch these
- When dispatched alongside other agents, read your task for explicit file ownership list

## Lessons — 2026-03-13
- Knowledge base cache: 5 min TTL in ai-agent.ts — never fetch per AI reply
- Contact rules cache: 60s TTL in message-handler.ts — never query per incoming message
- Config cache TTL: use 300_000 (5 min), not 30_000 (30s)
- N+1 in unanswered-questions: collect IDs → one batch .in() query → group in JS
- Memory leaks: replyTimestamps and dailyReplyCounts need hourly cleanup via setInterval
- Learning engine: batch all "add" actions into single .insert([...]) call
- Dead code must be deleted, not kept — webhook/route.ts with wrong API key was removed
- Always run `npm run build` after changes to verify no TypeScript errors

## Anti-Ban Protection Module — 2026-03-17
A new `session-manager/src/antiban.ts` module was created to reduce WhatsApp ban risk:

### What was built and WHY:
1. **Gaussian jitter** (Box-Muller transform) — BEFORE: `Math.random()` produced uniform delays (1.5-4.5s) that formed detectable patterns. NOW: gaussian distribution clusters delays around the midpoint, mimicking human reaction times. Night hours (23:00-07:00 Israel) automatically 3x longer.
2. **Read receipts** — BEFORE: no `readMessages()` calls — WhatsApp never saw blue ticks, a major bot tell. NOW: `socket.readMessages([msg.key])` called on every incoming message before processing. Added in session-manager.ts messages.upsert handler.
3. **Health monitoring** — tracks disconnects and failed message sends with risk scoring (0-100). Score decays 2pts/min. 4 risk levels: low/medium/high/critical. Accessible via `GET /sessions/:tenantId/health`.
4. **Presence pause scheduler** — BEFORE: bot was always "online" 24/7 (unnatural). NOW: every 1-3 hours, sends `unavailable` for 5-20 minutes, then returns to `available`. Messages still process normally — only the displayed status changes.
5. **Message send failure tracking** — `makeHumanSend()` now catches send errors and feeds them to the health monitor via `onMessageFailed()`.

### Key architectural decisions:
- `baileys-antiban` npm package was evaluated but rejected — no `dist/` folder, broken package. All features implemented from scratch.
- Antiban module is stateless per-process (no DB persistence for health scores) — scores reset on deploy. This is intentional: fresh start after deploy is fine.
- Presence pause does NOT stop message processing — only affects the visible "online" status indicator.
- `getHumanDebounceDelay()` replaces the old `getDebounceDelay` in message-handler.ts.

## LID Conversation Splitting Fix v2 — 2026-03-17
v1 fix (preserve lid_* rows + deferred fix + sweep) was INSUFFICIENT. Conversations still split.

### The REAL root cause (discovered v2)
When contact sends via LID and owner replies, TWO conversations created:
1. LID conversation (`phone_number = "200274408960102"`) — from incoming LID message (mapping unknown)
2. Real-phone conversation (`phone_number = "972522827528"`) — from owner reply (phone or dashboard)

The v1 deferred fix (3s) ran TOO LATE — owner replies arrive in <1s. Name matching unreliable.

### v2 Fix: `mergeLidIfNeeded()` — proactive merge BEFORE conversation creation
New function that runs BEFORE any real-phone conversation is created:
1. Reverse-lookup in `tenantLidToPhone` map — find any LID→this phone mapping
2. `socket.onWhatsApp(realPhone)` API — asks WhatsApp "what LID does this phone have?"
3. If found → `fixLidConversation()` merges before the new conversation is upserted

Called from TWO critical paths:
- `messages.upsert` handler: before `handleIncomingMessage` for real-phone messages (covers fromMe=true)
- `sendMessage()`: before conversation upsert (covers dashboard owner replies)

### Also improved:
- Deferred fix delay: 3s → 1s (contacts.upsert fires in ~200ms)
- Deferred fix now has `socket.onWhatsApp()` as last-resort fallback

### v1 fixes (still active, layered defense):
1. `clearAuthState()` now preserves `lid_*` and `contacts` rows
2. Deferred LID fix: 1-second setTimeout after unresolved LID message
3. Periodic LID sweep: every 60 seconds, finds conversations with ≥15-digit phone numbers
4. LID sweep SQL optimized: `.like("phone_number", "_______________%" )` (15 underscores)
5. Connection state guard on deferred fix

### Code review fixes (as any removal, named constants):
- `(sessionInfo as any)._lidSweepInterval` → typed `sessionInfo.lidSweepInterval` (added to SessionInfo interface)
- Magic numbers → `LID_SWEEP_INTERVAL_MS`, `LID_DEFERRED_FIX_DELAY_MS`, `MAX_KNOWLEDGE_BASE_ENTRIES`
- `handoff_collect_email` added to TenantProfile and Tenant interfaces (removed `as any` casts)
- "double-encrypted" misleading comment → accurate "per-field AES-256-GCM" description

## Encrypted Creds Backup — 2026-03-17
WHY: Every deploy killed WhatsApp connections because `clearAuthState` wiped creds, and there was no backup.

### What was built:
1. `whatsapp_creds_backup` table — separate from `whatsapp_sessions`, survives `clearAuthState`
2. `saveCredsBackup()` — encrypts creds + all signal keys individually with AES-256-GCM (unique IV per field)
3. `restoreCredsFromBackup()` — decrypts and restores to cache on deploy
4. `restoreAllSessions()` checks backup table when no regular creds exist
5. `clearSessionData()` deletes backup on terminal states (loggedOut, connectionReplaced) to prevent stale restore loops
6. Creds backup saved 10s after connect + refreshed every 6 hours

## Webhook Route Deleted — 2026-03-17
`src/app/api/webhook/route.ts` was legacy code from pre-multi-tenant era. Used OpenAI GPT-4, WhatsApp Cloud API, no tenant_id in upsert conflict key (CRITICAL tenant isolation breach). Deleted entirely.

## Production Security Hardening (API Routes) — 2026-03-17

### OAuth Routes Fixed
- `src/app/api/oauth/google/route.ts` + `outlook/route.ts`: Added `getUser()` auth + tenant ownership check before initiating OAuth flow. State parameter now HMAC-signed with `OAUTH_STATE_SECRET`.
- `src/app/api/oauth/google/callback/route.ts` + `outlook/callback/route.ts`: Added HMAC verification + 10-minute state expiry.
- WHY: Previously NO auth — anyone could link their Google/Outlook to any tenant. CSRF attack vector.

### getSession() → getUser() Migration
- `messages/route.ts` and `contacts/route.ts` (all 3 handlers: GET, POST, DELETE) now use `getUser()` instead of `getSession()`.
- WHY: `getSession()` reads JWT from cookie without server validation. `getUser()` validates against Supabase auth server — catches expired/revoked sessions.

### Sessions GET Auth
- `sessions/[tenantId]/[action]/route.ts` GET handler: Added tenant ownership check (`owner_id = user.id`).
- WHY: Any authenticated user could previously check any tenant's session status.

### SSRF Protection
- `leads/export/route.ts`: Blocks private IPs (127.x, 10.x, 192.168.x, 172.16-31.x, 169.254.x, localhost, 0.0.0.0, ::1) in webhook URL.
- WHY: Tenant-controlled URL could probe internal network.

### Calendly Webhook
- `webhooks/calendly/route.ts`: `===` → `crypto.timingSafeEqual()` for HMAC comparison.
- WHY: String comparison leaks timing info that could be used to forge signatures.

### Anti-Ban Improvements in session-manager
- **Unique browser fingerprint**: Each tenant gets a deterministic browser from `BROWSER_OPTIONS` array (6 options: Chrome/Ubuntu, Safari/macOS, Edge/Windows, etc.) via hash of tenantId. BEFORE: all tenants used `Browsers.ubuntu("Chrome")` — high ban risk when multiple accounts share same IP.
- **Read receipt delay**: 1-3 second gaussian delay before `socket.readMessages()`. BEFORE: instant read receipts (bot-like).
- **Global rate limit**: Max 25 messages/minute across ALL conversations via `getGlobalSendDelay()` in antiban.ts. Prevents burst sending.

### SESSION_ENCRYPTION_KEY Enforcement
- `session-store.ts`: Loud warning on startup if missing. `saveCredsBackup()` now throws instead of silently returning.

## Improvement Note (2026-03-14)
[Score: 1/10] For Supabase Realtime implementation tasks, backend work is typically limited to ensuring tables have Realtime enabled and proper RLS policies. Avoid excessive iterations when the core work is frontend integration.

## Improvement Note (2026-03-15)
[Score: 2/10] When analyzing session-manager code for contact_name handling in outgoing messages, avoid infinite loops by setting internal iteration limits and validating tool responses early.

## Improvement Note (2026-03-15)
[Score: 2/10] When analyzing TypeScript/Next.js code, first verify the file structure and dependencies. If code analysis tools fail, report specific errors encountered rather than timing out.

## Improvement Note (2026-03-17)
[Score: 2/10] When facing iteration limits, prioritize the most critical investigation steps first and provide partial findings rather than failing completely.

## Positive Pattern (2026-03-17)
[Score: 9/10] When investigating version-specific issues, always check commit history for recent fixes and correlate with server logs to validate ongoing problems. The infinite QR loop fix in commit e7985ee is critical for session stability.

## Positive Pattern (2026-03-17)
[Score: 8/10] When investigating OAuth issues, clearly map which OAuth flow (authentication vs. integration) is being discussed and how they interact.

## Anti-Ban Fixes — 2026-03-22
4 fixes implemented in baileys-service:
1. **Identical message detection** (`antiban.ts`): `canSendContent()` blocks same text to 3+ different conversations in 30 min
2. **Risk score tracking** (`session-manager.ts`): 403→100pts, 515→+10, 408→+5, frequent disconnects→+15, decay -2/probe
3. **Read receipts** (`message-handler.ts`): `socket.readMessages([msg.key])` before processing
4. **markOnlineOnConnect: false** (`session-manager.ts`): stealth connect

## AI Agent Unification — 2026-03-22
3 separate AI agents (`src/lib/ai-agent.ts`, `baileys-service/src/ai-agent.ts`, `session-manager/src/ai-agent.ts`) unified:
- Shared `buildRules()` function with 14 canonical Hebrew rules
- `trimAtGap()` — 40-minute gap detection (silence > 40 min = new conversation boundary)
- History: 10 → 20 messages, includes `created_at` for gap detection
- max_tokens: Cloud API & Baileys = 300, Session-Manager cron = 500
- Each service remains separate (different imports, different contexts) but identical behavior

## Full Backend Audit — 2026-03-22

### Bugs Fixed:
1. **Missing tenant_id filter in processStatusUpdate** (`webhooks/whatsapp-cloud/route.ts`): Status update query `.eq("wa_message_id", status.id)` had no `tenant_id` filter — cross-tenant data corruption possible. Added `.eq("tenant_id", config.tenant_id)`.

2. **cloud-signup/callback (global) missing 3 features** (`/api/cloud-signup/callback/route.ts`): This OAuth callback path was missing: (a) long-lived token exchange (stored short-lived ~1h token), (b) Baileys mutual exclusion disconnect, (c) `connection_type: 'cloud'` in tenant update. All 3 fixed to match the other two callback paths.

3. **CORS `origin: "*"` with `credentials: true`** (`session-manager/src/server.ts`): Invalid combination — browsers reject `Access-Control-Allow-Credentials: true` when origin is `*`. Removed `credentials: true` since all auth is via Bearer token header, not cookies.

4. **`_reminderSentAt` Map unbounded growth** (`session-manager/src/server.ts`): Map grew forever — one entry per conversation that got a reminder. Added cleanup interval (every 30 min, evicts entries older than debounce window).

5. **Dead code `phoneWarning`** (`tenants/[tenantId]/route.ts`): Variable declared as `null`, never assigned to, always returned as `null` in response. Removed.

6. **`_userUriCache` unbounded growth** (`calendar-providers/calendly.ts`): Cache keyed by token with no eviction — grows with each token rotation. Added TTL (1 hour) and size-based eviction when cache exceeds 50 entries.

### Audit Coverage (reviewed, no issues found):
- All 30 API route files in `src/app/api/`
- All 5 lib files in `src/lib/`
- All 11 session-manager source files
- Auth patterns (getUser() used correctly everywhere)
- Tenant ownership verification (present on all tenant-scoped routes)
- Input validation (present where needed)
- Error handling (Supabase errors checked consistently)
- Multi-tenant isolation (tenant_id filters present on all queries)

### Patterns Confirmed Working:
- Webhook signature verification uses `timingSafeEqual` correctly
- OAuth state parameters use HMAC signing + 10-min expiry
- Rate limiting and deduplication in webhook route with proper cleanup intervals
- Learning engine correctly validates AI-generated IDs before mutations
- Calendar providers handle token refresh and error cases properly

## Escalation to Human (Owner Notification) — 2026-03-22

### Problem Found:
When the AI bot decided to hand off to a human (responding with `[PAUSE]`), the system only paused the conversation in DB (`is_paused: true`). The business owner was NOT notified immediately via WhatsApp. The only notification was a cron-based "unanswered customer" reminder that ran every 5 minutes with a 10-minute delay — meaning the owner could wait 10+ minutes before knowing a customer needs help.

### Fix Implemented:
Added immediate WhatsApp notification to the business owner when `[PAUSE]` is detected in Cloud API webhook route:

1. **`notifyOwnerOfEscalation()`** in `src/app/api/webhooks/whatsapp-cloud/route.ts`:
   - Fetches `owner_phone` from `tenants` table (with tenant_id filter)
   - Normalizes phone number (handles `0xx` local Israeli → `972xx` international)
   - Validates owner_phone exists and is valid; logs warning and skips if empty/invalid
   - Guards against sending notification to the owner if they ARE the customer
   - Generates AI summary via `summarizeConversationForHandoff()` (best-effort, non-blocking)
   - Sends formatted notification with customer name, phone, and conversation summary
   - Entire function is wrapped in try/catch — fails silently (best-effort, never breaks main flow)

2. **`summarizeConversationForHandoff()`** added to `src/lib/ai-agent.ts`:
   - Mirrors the session-manager version but uses the Cloud API's Supabase admin client
   - Fetches last 20 messages from conversation (filtered by tenant_id)
   - Asks DeepSeek to summarize in Hebrew (3 bullet points max)
   - 15-second timeout to avoid blocking the webhook response
   - Returns empty string on failure (non-fatal)

3. **`normalizeOwnerPhone()`** helper:
   - Strips non-digit characters, converts Israeli local (10-digit starting with 0) to 972 prefix
   - Returns null for empty or too-short numbers

### Session Manager (Cron) — Already Working:
The unanswered-customer reminder cron in `session-manager/src/server.ts` already sends reminders to owners for paused conversations. This remains as a **second layer** — if the immediate notification fails or the owner doesn't respond within 10 minutes, the cron sends a follow-up reminder.

### Architecture Note:
- Cloud API: immediate notification happens in the webhook after() callback
- Session Manager: cron-based reminders remain as backup layer
- Both use `sendTextMessage` / `sendCloudMessage` to actually send WhatsApp messages (not just DB inserts)
- `owner_phone` normalization is consistent across both paths

## Website Intelligence Agent — 2026-03-22

### What was built:
A system that crawls a business website, extracts structured knowledge using DeepSeek, and feeds it into the AI customer support agent.

### Components:
1. **DB Migration** (`supabase/migrations/20260322150000_website_intelligence.sql`): Added `website_url` and `website_last_crawled_at` columns to tenants.

2. **Website Crawler** (`src/lib/website-crawler.ts`):
   - Fetches HTML, extracts text via cheerio, follows internal links (same domain, max 5 pages)
   - Page priority scoring: about/services/pricing/FAQ/contact get higher scores
   - SSRF protection: DNS resolution check, blocks private IPs (10.x, 172.16.x, 192.168.x, 127.x, ::1)
   - Respects robots.txt (basic Disallow rules)
   - 8s per-page timeout, 45s total, 500KB max per page, 3000 chars extracted per page
   - `crawlRelevantPages()` — lighter version for AI agent fallback (20s timeout, 3 pages max)

3. **Website Analyzer** (`src/lib/website-analyzer.ts`):
   - Sends crawled content to DeepSeek with `response_format: { type: 'json_object' }`
   - Extracts: business_name, description, products, hours, location, contact, 10-20 Q&A pairs
   - `answerFromWebsite()` — given pages + question, asks DeepSeek if it can answer
   - Defensive JSON parsing with fallback unwrapping (data, result wrappers)

4. **API Routes**:
   - `POST /api/tenants/[tenantId]/website-crawl` — crawl + analyze (maxDuration=60)
   - `POST /api/tenants/[tenantId]/website-crawl/apply` — apply analysis to tenant + knowledge_base (source='website')
   - Both have auth + tenant ownership checks

5. **AI Agent Website Fallback** (both `src/lib/ai-agent.ts` and `session-manager/src/ai-agent.ts`):
   - `shouldTryWebsiteFallback()` detects uncertainty patterns in Hebrew AI replies
   - `searchBusinessWebsite()` fetches tenant's website_url, crawls relevant pages, asks DeepSeek
   - Cloud API version uses full cheerio-based crawler; session-manager uses lightweight fetch+regex
   - Fallback runs BEFORE escalation — if website has the answer, customer gets it immediately

6. **Tenant PATCH route** — added `website_url` to allowed fields

### Architecture decisions:
- Session-manager gets a lightweight inline website fetch (no cheerio dependency) to avoid cross-service imports
- Website fallback only triggers on specific Hebrew uncertainty phrases, not on every reply
- `source='website'` in knowledge_base allows clean delete+re-insert on re-crawl
- Crawl results are NOT auto-applied — user reviews analysis first, then clicks apply