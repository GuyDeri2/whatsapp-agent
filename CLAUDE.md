# WhatsApp Agent — Project Context for Claude Code

## Task Delegation Rule (IMPORTANT)

When the user gives you a development task (feature, bug fix, refactor, audit, etc.), **always use the AI dev team system**:

1. **Read the PM knowledge**: `agents/pm/README.md`, `agents/pm/memory/memory.md`, `agents/shared/memory/memory.md`
2. **Plan like the PM**: Decide which agents are needed (frontend, backend, ux, security, devops, qa, database)
3. **Launch subagents via the Agent tool** — include each agent's README + skills + memory in the prompt
4. **Run independent agents in parallel**
5. **Synthesize results**, verify build, update memory

This applies to **all tasks except**: simple questions, quick lookups, conversations, and trivial one-line fixes. For those, respond directly.

The agents run as Claude Code subagents (Agent tool) — NOT via external APIs or terminal commands.

---

## What This Project Is
A **multi-tenant B2B SaaS** platform — **מזכירה AI (AI Secretary)** — that lets businesses automate customer communication with AI across two independent channels:
1. **WhatsApp Channel** — Meta Cloud API + DeepSeek AI for text-based support
2. **Voice Channel** — ElevenLabs Conversational AI + Twilio for phone calls & SMS

Both channels share a single **knowledge base** per tenant. Each has its own AI model, system prompts, and integrations.
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
| WhatsApp | Meta WhatsApp Cloud API (Embedded Signup, webhooks) |
| WhatsApp AI | DeepSeek API via OpenAI-compatible SDK (`model: deepseek-chat`) |
| Voice AI | ElevenLabs Conversational AI (`gpt-4o-mini`, TTS: `eleven_v3_conversational`) |
| Phone/SMS | Twilio (phone numbers + SMS for voice agent tools) |
| Deploy | Vercel (Next.js) + Render (session-manager cron service) |

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
│   │       ├── webhooks/whatsapp-cloud/route.ts  ← Meta webhook (GET verify + POST messages)
│   │       ├── tenants/route.ts
│   │       ├── tenants/[tenantId]/route.ts
│   │       ├── tenants/[tenantId]/messages/route.ts
│   │       ├── tenants/[tenantId]/contacts/route.ts
│   │       └── tenants/[tenantId]/cloud-signup/   ← OAuth flow (GET init + callback + DELETE disconnect)
│   ├── components/tenant/
│   │   ├── ConnectTab.tsx              ← WhatsApp Cloud API connect (Embedded Signup)
│   │   ├── SettingsTab.tsx             ← business profile + agent config
│   │   ├── CapabilitiesTab.tsx         ← knowledge base, agent mode, filters
│   │   ├── ChatTab.tsx                 ← WhatsApp chat display
│   │   ├── ContactsTab.tsx             ← contact rules (whitelist/blacklist)
│   │   └── VoiceTab.tsx               ← Voice channel management (ElevenLabs + Twilio)
│   └── lib/
│       ├── whatsapp-cloud.ts           ← Cloud API client (send, verify, config cache)
│       ├── ai-agent.ts                 ← AI reply generation (DeepSeek)
│       ├── elevenlabs.ts               ← ElevenLabs API client (voice agents, KB sync)
│       ├── voice-platform-config.ts    ← Voice platform config (Layer 1, immutable)
│       ├── voice-agent-setup.ts        ← Voice agent orchestration
│       ├── twilio.ts                   ← Twilio SMS service
│       └── supabase/
│           ├── client.ts               ← browser client
│           ├── server.ts               ← server component client
│           └── admin.ts                ← service role client
├── session-manager/
│   └── src/
│       ├── server.ts                   ← Express cron service (reminders, learning, auto-unpause)
│       ├── ai-agent.ts                 ← DeepSeek AI reply generation
│       ├── learning-engine.ts          ← batch learning from owner replies
│       ├── reminders.ts                ← meeting reminder logic
│       ├── scheduling.ts               ← meeting booking + availability
│       └── date-utils.ts               ← Hebrew date formatting
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
- `whatsapp_phone`, `whatsapp_connected`

### `whatsapp_cloud_config`
- `tenant_id` (FK → tenants), `phone_number_id`, `access_token`, `waba_id`, `webhook_verify_token`
- One row per tenant — stores Meta Cloud API credentials

### `conversations`
- `id`, `tenant_id`, `phone_number`, `contact_name`, `is_group`, `is_paused`, `updated_at`

### `messages`
- `id`, `conversation_id`, `role` (`user`/`assistant`/`owner`), `content`
- `is_from_agent`, `media_url`, `media_type`, `wa_message_id`, `status`, `created_at`

### `knowledge_base`
- `id`, `tenant_id`, `category`, `question`, `answer`, `source` (`manual`/`learned`), `updated_at`
- `elevenlabs_kb_id` — tracks synced ElevenLabs doc ID (for voice channel KB sync)

### `contact_rules`
- `id`, `tenant_id`, `phone_number`, `rule_type` (`allow`/`block`)

### `voice_catalog`
- `id`, `elevenlabs_voice_id` (UNIQUE), `name`, `display_name_he`, `gender`, `preview_url`, `is_default`

### `call_logs`
- `id`, `tenant_id` (FK), `elevenlabs_conversation_id`, `caller_phone`, `started_at`, `ended_at`, `duration_seconds`, `status`, `summary`, `transcript` (jsonb)

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
- Never log access tokens — only pass in Authorization headers

### Phone Numbers
- Stored without `+`, international format: `972501234567`
- Handle both `972x` (international) and `0x` (local Israeli) formats
- Cloud API accepts E.164 without `+` prefix

### AI (DeepSeek)
- Client: `new OpenAI({ apiKey: DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' })`
- Model: `deepseek-chat`
- JSON mode: `response_format: { type: 'json_object' }` — wraps arrays in object, parse robustly

### WhatsApp Cloud API
- Webhook endpoint: `/api/webhooks/whatsapp-cloud` (GET for verification, POST for messages)
- Webhook signature verification via `X-Hub-Signature-256` + `META_APP_SECRET`
- Message deduplication via `message_id` column (partial unique index)
- Meta requires webhook to return 200 within 2 seconds — process async
- Tenant routing: `phone_number_id` in webhook → lookup `whatsapp_cloud_config`

### Environment Variables
```
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
DEEPSEEK_API_KEY
META_APP_ID
META_APP_SECRET
META_API_VERSION (default: v21.0)
WHATSAPP_WEBHOOK_VERIFY_TOKEN
SESSION_MANAGER_URL
SESSION_MANAGER_SECRET
ELEVENLABS_API_KEY
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_FROM_NUMBER
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

### How to Use (Claude Code Commands)
```
# Run a task with the full team (Claude Code acts as PM)
/project:team "Add a search bar to the contacts page"

# Run a single specialist agent
/project:agent-frontend "Fix loading state in ChatTab"
/project:agent-backend "Add rate limiting to API routes"
/project:agent-database "Add indexes for slow queries"

# Give feedback to improve agent learning
/project:agent-feedback frontend 9 "Clean component, good TypeScript"
```

### How It Works
1. Claude Code acts as PM — reads agent knowledge, creates plan
2. Subagents launched via Agent tool (parallel when possible)
3. Each subagent has full Claude Code capabilities (Read, Edit, Write, Bash, Grep...)
4. Agents **actually implement** changes — edit files, write code, run commands
5. Memory files updated with lessons learned after each run

### Memory System
- Each agent has `agents/<role>/memory/memory.md` — learned patterns, project preferences
- Shared context: `agents/shared/memory/memory.md` — full project context
- Knowledge files: `agents/<role>/README.md` + `agents/<role>/skills/skills.md`
- Memory grows after every run + explicit feedback via `/project:agent-feedback`

---

## Running the Project

```bash
# Frontend + API (Next.js)
npm run dev         # port 3000

# Session Manager (cron service — reminders, learning, auto-unpause)
cd session-manager
npm run dev         # port 3001

# AI Dev Team (Claude Code commands)
# /project:team "your task"
# /project:agent-<role> "your task"
```

---

## Important Notes

- **Session Manager is cron-only** — runs reminders, batch learning, auto-unpause. No WebSocket sessions.
- **WhatsApp messages flow through webhooks** — Meta sends to `/api/webhooks/whatsapp-cloud`, Next.js processes serverlessly.
- **Embedded Signup (OAuth)** — tenants connect WhatsApp via Meta OAuth flow, credentials stored in `whatsapp_cloud_config`.
- **agent_prompt is user-controlled** — be aware of prompt injection risk when feeding it to the AI
- **Learning engine runs on cron** — batch processes owner replies daily at 02:00
- **Voice channel is independent** — ElevenLabs/Twilio code never imports WhatsApp code. Channels share only `knowledge_base` table.
- **Voice feature flag** — `voice_enabled` on tenants table. Instant per-tenant toggle without deployment.
- **KB sync to ElevenLabs** — ElevenLabs docs can't be updated in-place. Pattern: delete old → create new → update `elevenlabs_kb_id` → sync agent references.
- **Two-layer voice config** — Layer 1 (platform, immutable in `voice-platform-config.ts`) + Layer 2 (business owner, stored in DB)
