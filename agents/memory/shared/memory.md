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
