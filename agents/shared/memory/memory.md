# Shared Project Context

## Project Overview
**מזכירה AI (AI Secretary)** — a multi-tenant B2B SaaS platform with two independent communication channels:
1. **WhatsApp Channel** — Meta Cloud API + DeepSeek AI for text-based customer support
2. **Voice Channel** — ElevenLabs Conversational AI + Twilio for phone calls & SMS

Both channels share a single **knowledge base** per tenant. Each channel has its own AI model, system prompts, and integrations. The business owner enters KB data once.

Target market: Israeli small-to-medium businesses (restaurants, clinics, shops, service providers).
Primary language: Hebrew (RTL), secondary: English.

---

## Tech Stack

### Frontend (Next.js App)
- **Framework**: Next.js 16 (App Router), React 19, TypeScript (strict)
- **Styling**: CSS Modules + globals.css — NO external UI library
- **Auth**: Supabase SSR (`@supabase/ssr`) — server components where possible
- **Deploy**: Vercel

### Backend (Next.js API Routes)
- **API**: Next.js 16 App Router API routes (`src/app/api/`)
- **Database**: Supabase (PostgreSQL + RLS + Realtime)
- **Auth**: Supabase Auth (SSR helpers, service role in session-manager)

### Session Manager (Separate Node.js Service)
- **Framework**: Express + Node.js, TypeScript (`tsx` for dev)
- **WhatsApp**: Baileys 6.x (WebSocket-based WhatsApp Web protocol)
- **AI**: DeepSeek API via OpenAI-compatible SDK (`model: deepseek-chat`)
- **Process**: Always-on service, manages live WA connections per tenant

---

## Database Schema

### tenants
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| business_name | text | |
| description | text | |
| products | text | |
| target_customers | text | |
| agent_prompt | text | Custom AI instructions per tenant |
| agent_mode | enum | `learning` / `active` / `paused` |
| agent_filter_mode | enum | `all` / `whitelist` / `blacklist` |
| whatsapp_phone | text | |
| elevenlabs_agent_id | text | ElevenLabs agent ID (voice) |
| elevenlabs_voice_id | text | Selected voice from catalog |
| voice_settings | jsonb | `{stability, similarity_boost, speed}` |
| voice_first_message | text | Greeting for phone calls |
| voice_custom_instructions | text | Voice-specific AI instructions |
| voice_webhook_secret | text | Per-tenant webhook auth |
| twilio_phone_number | text | Assigned Twilio number |
| voice_enabled | boolean | Feature flag for voice channel |

### conversations
- id, tenant_id, phone_number, contact_name, is_group, updated_at

### messages
- id, conversation_id, role (user/assistant/owner), content, is_from_agent, media_url, media_type, created_at

### knowledge_base
- id, tenant_id, category, question, answer, source (manual/learned), updated_at
- elevenlabs_kb_id — tracks synced doc ID in ElevenLabs (voice channel)

### contact_rules
- id, tenant_id, phone_number, rule_type (allow/block)

### voice_catalog (NEW — 2026-03-29)
- id, elevenlabs_voice_id (UNIQUE), name, display_name_he, gender (male/female), preview_url, is_default

### call_logs (NEW — 2026-03-29)
- id, tenant_id (FK → tenants, CASCADE), elevenlabs_conversation_id, caller_phone, started_at, ended_at, duration_seconds, status, summary, transcript (jsonb)

---

## Directory Structure

```
/
├── src/
│   ├── app/
│   │   ├── page.tsx                      ← tenant list
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   ├── tenant/[id]/page.tsx          ← main dashboard
│   │   └── api/
│   │       ├── webhook/route.ts
│   │       ├── tenants/route.ts
│   │       ├── tenants/[tenantId]/route.ts
│   │       ├── tenants/[tenantId]/messages/route.ts
│   │       ├── tenants/[tenantId]/contacts/route.ts
│   │       └── sessions/[tenantId]/[action]/route.ts
│   ├── components/tenant/
│   │   ├── ConnectTab.tsx
│   │   ├── SettingsTab.tsx
│   │   ├── CapabilitiesTab.tsx
│   │   ├── ChatTab.tsx
│   │   ├── ContactsTab.tsx
│   │   └── VoiceTab.tsx              ← Voice channel management
│   └── lib/
│       ├── supabase/
│       │   ├── client.ts
│       │   ├── server.ts
│       │   └── admin.ts
│       ├── elevenlabs.ts             ← ElevenLabs API client
│       ├── voice-platform-config.ts  ← Platform config (Layer 1)
│       ├── voice-agent-setup.ts      ← Voice agent orchestration
│       └── twilio.ts                 ← Twilio SMS service
├── session-manager/
│   └── src/
│       ├── server.ts                     ← Express + cron
│       ├── session-manager.ts            ← Baileys multi-session
│       ├── message-handler.ts            ← incoming WA messages
│       ├── ai-agent.ts                   ← DeepSeek AI replies
│       ├── learning-engine.ts            ← batch learning
│       └── session-store.ts             ← Supabase session persistence
└── agents/                              ← AI dev team (this folder)
```

---

## Agent Modes
- **learning**: messages stored, owner replies manually, AI learns from patterns
- **active**: AI auto-replies to customer messages
- **paused**: messages stored silently, no replies

## Filter Modes
- **all**: AI responds to everyone
- **whitelist**: AI only responds to contacts in the allow list
- **blacklist**: AI responds to everyone EXCEPT contacts in the block list

---

## Key Conventions
- Phone numbers: always stored without `+`, in international format (e.g. `972501234567`)
- WhatsApp JIDs: `{phone}@s.whatsapp.net` (individual) or `{groupId}@g.us` (group)
- Supabase service role key: only used in session-manager and Next.js API routes (never in browser)
- Environment file: `.env.local` at project root
- OpenAI SDK pointed at DeepSeek: `baseURL: 'https://api.deepseek.com'`
- 3 AI agent files unified (2026-03-22): `src/lib/ai-agent.ts` (Cloud API), `baileys-service/src/ai-agent.ts` (Baileys), `session-manager/src/ai-agent.ts` (cron) — same 14 Hebrew rules via `buildRules()`, same `trimAtGap()` (40-min gap), same 20-message history

---

## Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_URL=...
DEEPSEEK_API_KEY=...
ELEVENLABS_API_KEY=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=...
```

---

## Comprehensive Code Audit — 2026-03-23

### Overview
15 parallel audit agents scanned the entire codebase. Found **253 issues** (41 critical, 56 high, 82 medium, 72 low). 15 parallel fix agents deployed to resolve all findings.

### Top Recurring Patterns (apply to ALL future code):

1. **Supabase error handling**: `.single()` returns `error.code === 'PGRST116'` for 0 rows, not `data: null`. Always check error.code before data.
2. **Error message leakage**: NEVER return `error.message` from Supabase to client — it exposes schema details. Use generic messages + server-side logging.
3. **In-memory state doesn't work in Vercel serverless**: Maps, setInterval, rate limiters reset between invocations. Use DB or Redis instead.
4. **req.json() needs try-catch**: Always wrap in try-catch, return 400 for malformed JSON.
5. **SSRF protection must cover redirects**: `redirect: "follow"` bypasses URL validation. Use `redirect: "manual"` and validate each hop.
6. **UUID validation**: Always validate tenantId/userId params as UUID before passing to Supabase queries.
7. **Supabase 1000 row limit**: Default limit is 1000 rows. Use `{ count: "exact", head: true }` for counts, add explicit `.limit()` for all queries.
8. **DELETE verification**: Supabase DELETE returns success even if 0 rows affected. Always verify with `.select()` or count.
9. **useRef for Supabase client**: In React client components, always use `useRef(createClient())` — never call `createClient()` at component level (causes re-render loops).
10. **timingSafeEqual for HMAC**: Always use `crypto.timingSafeEqual()` for signature comparison, never `===` or `!==`.

### Critical Security Fixes Applied:
- Open redirect in auth callback (next param validation)
- Access tokens moved from URL query strings to Authorization headers
- Apple credentials encrypted with AES-256-GCM before DB storage
- CORS restricted from `*` to specific origins in session-manager
- Dead `/admin/set-key` endpoint removed (attack surface)
- Data deletion endpoint now actually deletes data (GDPR/Meta compliance)
- Webhook dedup moved from in-memory Map to DB-based (wa_message_id constraint)
- Calendly webhook signature verification fixed (was using wrong header format)
- SSRF protection upgraded: DNS resolution, IPv6 private ranges, redirect validation
- Prompt injection defense strengthened with Unicode stripping + explicit boundary instructions

### Performance Fixes Applied:
- Middleware: webhook bypass moved before getUser() (saves ~100ms per webhook)
- Admin analytics: count queries instead of fetching all rows
- O(n*m) join replaced with Map-based O(n+m) lookup
- Pure functions extracted from 1160-line tenant component
- InactivityGuard only activates for logged-in users
- Supabase singleton pattern applied across session-manager

---

## Lessons Learned

### Baileys Event Patterns
- `messages.upsert` fires for BOTH incoming AND outgoing messages (isFromMe echo). Always filter `isFromMe` to avoid duplicates.
- Baileys can fire the same event multiple times. Always use `wa_message_id` for deduplication.
- `contacts.upsert` provides two name types: `contact.name` (phonebook = highest priority) and `contact.notify` (push name = fallback).

### WhatsApp Profile Pictures
- `profilePictureUrl()` returns URLs that **expire** after some time. Must periodically refresh.
- 404 errors are normal (user has no picture or privacy is set to "contacts only"). Don't log these.
- Add delays (200ms+) between calls to avoid WhatsApp rate-limiting.
- Fetch on-demand when a new conversation is created, don't rely only on batch sync.

### Contact Name Priority (WhatsApp Web parity)
- Priority: Phonebook (device contact name) > Push name > Phone number
- Never overwrite a phonebook name with a push name.
- `handleIncomingMessage` should only set pushName when `contact_name IS NULL`.

### Session Persistence (Baileys)
- **`socket.logout()` DESTROYS the session** — only use when user explicitly disconnects.
- **`socket.end()`** just closes the WebSocket — auth state remains valid for reconnect.
- Always `flushCacheToDB()` before closing socket to prevent pending write loss.
- Add reconnect cooldown (30s+) to prevent notification spam on the user's phone.
- Use exponential backoff (5s base, 60s cap) for disconnect retries.

