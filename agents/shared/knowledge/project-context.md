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

## Agent Team

| Agent | Role |
|-------|------|
| `pm` | Orchestrator |
| `frontend` | React/Next.js UI |
| `backend` | API routes, Supabase, session-manager |
| `ux` | UX design, Hebrew copy |
| `security` | Auth, RLS, data isolation |
| `devops` | Vercel, PM2, infrastructure |
| `qa` | Tests, edge cases |
| `database` | Schema, migrations, RLS policies, indexes |

---

## Infrastructure & CLI Access

All agents have shell access via `execute_cli_command`. Use these tools to verify, deploy, and manage services.

### Vercel (Next.js frontend)
- Deploy: `npx vercel --prod --yes`
- Logs: `npx vercel logs <url>`
- Env vars: `npx vercel env ls` / `npx vercel env add NAME production`
- Auth: `VERCEL_TOKEN` env var

### Render (session-manager Node.js service)
- REST API: `https://api.render.com/v1`
- Auth header: `Authorization: Bearer $RENDER_API_KEY`
- Trigger deploy: `POST /services/<SERVICE_ID>/deploys`
- View logs: `GET /services/<SERVICE_ID>/logs?limit=100`

### Supabase (database + auth)
- Migrations: `npx supabase db push`
- Types: `npx supabase gen types typescript --project-id <id>`
- Migration status: `npx supabase migration list`
- Execute SQL: `npx supabase db execute --file <path>`
- Auth: `SUPABASE_ACCESS_TOKEN` env var

### Environment Variables (in .env.local)
```
VERCEL_TOKEN=...
RENDER_API_KEY=...
SUPABASE_ACCESS_TOKEN=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_URL=...
DEEPSEEK_API_KEY=...
```

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

### Database / Supabase
- RLS must be ENABLED with `ALTER TABLE x ENABLE ROW LEVEL SECURITY` AND a policy must be created — enabling alone blocks all access.
- Use CHECK constraints (not PostgreSQL enums) for status columns — easier to add new values.
- Always use `ON DELETE CASCADE` for child tables referencing `tenants(id)`.
- Adding a NOT NULL column to a populated table: add nullable → backfill → add constraint.
