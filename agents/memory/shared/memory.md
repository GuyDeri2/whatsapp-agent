# Shared Project Context

## Project Overview
**WhatsApp Agent** — a multi-tenant B2B SaaS platform that lets businesses automate their WhatsApp customer support using AI.

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

### conversations
- id, tenant_id, phone_number, contact_name, is_group, updated_at

### messages
- id, conversation_id, role (user/assistant/owner), content, is_from_agent, media_url, media_type, created_at

### knowledge_base
- id, tenant_id, category, question, answer, source (manual/learned), updated_at

### contact_rules
- id, tenant_id, phone_number, rule_type (allow/block)

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
│   │   └── ContactsTab.tsx
│   └── lib/supabase/
│       ├── client.ts
│       ├── server.ts
│       └── admin.ts
├── session-manager/
│   └── src/
│       ├── server.ts                     ← Express + cron
│       ├── session-manager.ts            ← Baileys multi-session
│       ├── message-handler.ts            ← incoming WA messages
│       ├── ai-agent.ts                   ← DeepSeek AI replies
│       ├── antiban.ts                    ← Anti-ban protection (health, jitter, presence)
│       ├── learning-engine.ts            ← batch learning
│       └── session-store.ts             ← Supabase session persistence + encrypted backup
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

---

## Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_URL=...
DEEPSEEK_API_KEY=...
```

---

## Lessons Learned

### User Preferences (Guy Deri) — 2026-03-13
- Wants agents to run INSIDE Claude Code (not via `npx tsx run.ts` in terminal) — Claude Code IS the agent runtime
- Prefers parallel agent execution with zero file conflicts — assign file ownership explicitly per agent
- Wants PM to ask clarifying questions BEFORE starting work, not after delivering wrong output
- Wants agents to genuinely learn from sessions and remember preferences across conversations
- Output style: concise, actionable, in Hebrew for user-facing copy, English for all code
- Approves the multi-agent army approach: PM orchestrates, specialists execute in parallel
- Wants full coordination between agents — they must not step on each other's files

### Performance Patterns Learned — 2026-03-13
- Knowledge base should be cached (5 min TTL) — never fetched per AI reply
- Contact rules should be cached (60s TTL) — never fetched per incoming message
- Tenant config cache: 30s was too short, 5 min is correct
- `.limit(100)` is mandatory on all message queries — no unbounded fetches
- `React.memo` should be applied to ALL tab components — parent re-renders are frequent
- N+1 queries must be converted to batch queries — 31 queries → 2 is the goal
- `SELECT *` should be avoided — specify columns explicitly
- `setInterval` must always be cleaned up in useEffect return function
- Dead code (like wrong-API-key webhook routes) should be deleted, not kept "just in case"

### Coordination Patterns That Worked — 2026-03-13
- Split agent tasks by FILE OWNERSHIP: each agent gets exclusive rights to specific files
- Backend owned: session-manager/src/*, api routes
- Frontend owned: src/app/tenant/[id]/page.tsx, src/components/tenant/*.tsx
- Database owned: supabase/migrations/ (new files only)
- This approach: zero conflicts, all 3 agents finished cleanly

### Anti-Ban & WhatsApp Safety Patterns — 2026-03-17
- **Read receipts are critical**: `socket.readMessages([msg.key])` on every incoming message — skipping blue ticks is a major bot tell
- **Gaussian jitter > uniform random**: Use Box-Muller transform for delays — human reaction times are gaussian, not uniform
- **Presence pause**: periodically send `unavailable` for 5-20 min — always-online is a bot signature. Messages still process normally.
- **Health monitoring**: track disconnects (especially 403/401) and failed sends. Risk scoring with decay (2pts/min).
- **Night mode**: Israeli hours 23:00-07:00 should have 3x longer response delays
- **System JID filtering**: filter @broadcast, @newsletter, 0@s.whatsapp.net, 1-3 digit JIDs, WhatsApp support numbers, Meta probe ranges (1203631XXXX, 1650XXXXXXX). This mimics real WhatsApp client behavior — safe to keep.
- **baileys-antiban npm package is broken** (no dist/) — don't attempt to use it. Build features from scratch.

### LID (Linked Identity) System Knowledge — 2026-03-17 (UPDATED)
- WhatsApp LIDs are pseudo-IDs (e.g., `217875201687576@lid`) — same contact can message via both LID and real phone JID
- LID numbers are always ≥15 digits; real Israeli phones are ≤13 digits
- `clearAuthState()` must preserve `lid_*` rows and `contacts` row in whatsapp_sessions
- **CRITICAL FIX v2**: `mergeLidIfNeeded()` runs BEFORE any real-phone conversation is created — prevents split conversations
  - Reverse-lookups memory LID→phone map, falls back to `socket.onWhatsApp()` API
  - Called from both `messages.upsert` handler and `sendMessage()`
- LID resolution layers: memory map → DB fallback → name matching → onWhatsApp API
- Deferred fix: 1s timeout (was 3s) + onWhatsApp last-resort fallback
- LID sweep: periodic 60s check for ≥15-digit phone conversations

### Encrypted Creds Backup — 2026-03-17
- `whatsapp_creds_backup` table — separate from `whatsapp_sessions`, survives `clearAuthState`
- Each field encrypted individually with AES-256-GCM + unique random IV per field per write
- `SESSION_ENCRYPTION_KEY` env var required
- Backup saved 10s after connect + refreshed every 6h
- Deleted on terminal disconnect (loggedOut/connectionReplaced) to prevent stale restore loops
- `restoreAllSessions()` checks backup table when no regular creds exist → auto-reconnect after deploy

### Production Security Hardening — 2026-03-17
A full security audit was performed before market launch. 7 issues found and fixed:
1. **OAuth CSRF** (P0): Routes had no auth. Now require user login + tenant ownership + HMAC-signed state (10min expiry).
2. **getSession→getUser** (P1): 4 route handlers migrated to server-validated auth.
3. **Sessions GET** (P1): Added tenant ownership check.
4. **Calendly webhook** (P2): Timing-safe HMAC comparison.
5. **SSRF** (P2): Lead webhook URL now blocks private IPs.
6. **SESSION_ENCRYPTION_KEY** (P2): Loud warning + throw on backup attempt if missing.
7. **Anti-ban**: Unique browser fingerprint per tenant (6 options, hash-based), read receipt delay (1-3s gaussian), global rate limit (25 msgs/min).
- New env var: `OAUTH_STATE_SECRET` (optional, falls back to SUPABASE_SERVICE_ROLE_KEY)
- User decision: speed > safety — typing cap stays 3s max, no proportional duration for long messages.

### New DB Tables — 2026-03-17
- `whatsapp_creds_backup`: tenant_id (PK), encrypted_creds (jsonb), encrypted_keys (jsonb), updated_at
- `tenants.handoff_collect_email`: boolean, default false — controls whether AI asks for email during handoff
