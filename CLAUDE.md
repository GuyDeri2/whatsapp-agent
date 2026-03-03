# WhatsApp Agent — Project Context for Claude Code

## What This Project Is
A **multi-tenant B2B SaaS** platform that lets businesses automate their WhatsApp customer support with AI.
- Target: Israeli small-to-medium businesses (restaurants, clinics, shops)
- Primary language: Hebrew (RTL), secondary: English
- Developer: Guy Deri

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend + API | Next.js 16 (App Router), React 19, TypeScript strict |
| Styling | CSS Modules + globals.css — **no external UI library** |
| Auth | Supabase SSR (`@supabase/ssr`) |
| Database | Supabase (PostgreSQL + RLS + Realtime) |
| WhatsApp | Baileys 6.x (WebSocket, in session-manager service) |
| AI | DeepSeek API via OpenAI-compatible SDK (`model: deepseek-chat`) |
| Deploy | Vercel (Next.js) + dedicated VPS (session-manager) |

---

## Repository Structure

```
/
├── src/
│   ├── app/
│   │   ├── page.tsx                    ← tenant list (root)
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   ├── tenant/[id]/page.tsx        ← main dashboard (tabbed)
│   │   └── api/
│   │       ├── webhook/route.ts
│   │       ├── tenants/route.ts
│   │       ├── tenants/[tenantId]/route.ts
│   │       ├── tenants/[tenantId]/messages/route.ts
│   │       ├── tenants/[tenantId]/contacts/route.ts
│   │       └── sessions/[tenantId]/[action]/route.ts
│   ├── components/tenant/
│   │   ├── ConnectTab.tsx              ← WhatsApp QR connect
│   │   ├── SettingsTab.tsx             ← business profile + agent config
│   │   ├── CapabilitiesTab.tsx         ← knowledge base, agent mode, filters
│   │   ├── ChatTab.tsx                 ← WhatsApp chat display
│   │   └── ContactsTab.tsx             ← contact rules (whitelist/blacklist)
│   └── lib/supabase/
│       ├── client.ts                   ← browser client
│       ├── server.ts                   ← server component client
│       └── admin.ts                    ← service role client
├── session-manager/
│   └── src/
│       ├── server.ts                   ← Express + cron jobs
│       ├── session-manager.ts          ← Baileys multi-session
│       ├── message-handler.ts          ← routes incoming WA messages
│       ├── ai-agent.ts                 ← DeepSeek AI reply generation
│       ├── learning-engine.ts          ← batch learning from owner replies
│       └── session-store.ts            ← Supabase-backed session persistence
├── agents/                             ← AI dev team (see below)
├── supabase/                           ← DB migrations
├── .env.local                          ← secrets (gitignored)
└── CLAUDE.md                           ← this file
```

---

## Database Schema (Key Tables)

### `tenants`
- `id` (uuid PK), `business_name`, `description`, `products`, `target_customers`
- `agent_prompt` — custom AI instructions (user-editable, fed into system prompt)
- `agent_mode` — `learning` | `active` | `paused`
- `agent_filter_mode` — `all` | `whitelist` | `blacklist`
- `whatsapp_phone`

### `conversations`
- `id`, `tenant_id`, `phone_number`, `contact_name`, `is_group`, `updated_at`

### `messages`
- `id`, `conversation_id`, `role` (`user`/`assistant`/`owner`), `content`
- `is_from_agent`, `media_url`, `media_type`, `created_at`

### `knowledge_base`
- `id`, `tenant_id`, `category`, `question`, `answer`, `source` (`manual`/`learned`), `updated_at`

### `contact_rules`
- `id`, `tenant_id`, `phone_number`, `rule_type` (`allow`/`block`)

---

## Key Conventions

### Code Style
- TypeScript strict mode everywhere
- Prefer Server Components in Next.js; add `'use client'` only when needed
- Always handle `{ data, error }` from Supabase — check error before using data
- Error responses: `NextResponse.json({ error: '...' }, { status: 4xx })`

### Security (Critical)
- **Every DB query must filter by `tenant_id`** — multi-tenant isolation
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser
- Always verify tenant ownership in API routes before acting:
  ```typescript
  const { data: tenant } = await supabase.from('tenants')
    .select('id').eq('id', tenantId).eq('user_id', user.id).single();
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  ```

### Phone Numbers
- Stored without `+`, international format: `972501234567`
- WhatsApp JID: `972501234567@s.whatsapp.net` (individual), `...@g.us` (group)
- Handle both `972x` (international) and `0x` (local Israeli) formats

### AI (DeepSeek)
- Client: `new OpenAI({ apiKey: DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' })`
- Model: `deepseek-chat`
- JSON mode: `response_format: { type: 'json_object' }` — wraps arrays in object, parse robustly

### Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_URL
DEEPSEEK_API_KEY
```
File: `.env.local` at project root (gitignored). See `.env.local.example`.

---

## AI Dev Team (`agents/`)

A multi-agent system for getting structured development guidance from specialized AI agents.

### Agents
| Role | Responsibility |
|------|---------------|
| `pm` | Orchestrator — plans, dispatches, synthesizes |
| `frontend` | React/Next.js UI implementation |
| `backend` | API routes, Supabase, session-manager logic |
| `ux` | UX design, user flows, Hebrew copy |
| `security` | Security review, auth, RLS, data protection |
| `devops` | Vercel, PM2, CI/CD, infrastructure |
| `qa` | Tests, edge cases, acceptance criteria |

### How to Use
```bash
cd agents

# Run a task (PM orchestrates the team)
npx tsx run.ts "Add a search bar to the contacts page"
npx tsx run.ts "Add rate limiting to API routes"
npx tsx run.ts "Improve the WhatsApp reconnect error UX"

# Give explicit feedback (agents learn from it)
npx tsx run.ts feedback frontend 9 "Clean component, good TypeScript"
npx tsx run.ts feedback backend 5 "Forgot to validate tenant ownership"
```

### How It Works
1. PM receives command → creates structured plan (JSON)
2. Relevant agents run **in parallel** (or sequential when there are dependencies)
3. PM synthesizes all outputs into an actionable implementation plan
4. Reviewer LLM evaluates each agent → updates `agents/memory/<role>/memory.md`
5. Run logs saved to `agents/logs/<runId>.json`

### Memory System
- Each agent has `agents/memory/<role>/memory.md` — learned patterns, project preferences
- Shared context: `agents/memory/shared/memory.md` — full project context
- Memory grows automatically after every run
- Give explicit feedback to accelerate learning

---

## Running the Project

```bash
# Frontend + API (Next.js)
npm run dev         # port 3000

# Session Manager (WhatsApp service)
cd session-manager
npm run dev         # port 3001

# AI Dev Team
cd agents
npx tsx run.ts "your task"
```

---

## Important Notes

- **Session Manager must stay running** — Baileys WebSocket connections are stateful
- **Don't wipe Supabase auth state** — stored WhatsApp sessions are expensive to re-establish
- **Baileys may fire duplicate message events** — deduplication is important
- **agent_prompt is user-controlled** — be aware of prompt injection risk when feeding it to the AI
- **Learning engine runs on cron** — batch processes owner replies every 6 hours
