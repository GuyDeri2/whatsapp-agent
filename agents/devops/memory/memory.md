# DevOps Memory

## CRITICAL RULE: ALWAYS DEPLOY YOURSELF — NEVER ASK THE USER

After ANY code change, migration, or fix — YOU must deploy everything. Never say "run this yourself" or "apply this manually". You have full access to all deployment tools.

## Infrastructure Overview

- **Frontend + API**: Vercel (automatic deploys on push to `main`)
- **Session Manager**: Render Web Service (always-on, zero-downtime deploys)
- **Database**: Supabase managed PostgreSQL

## Service IDs & Connection Details

| Service | ID / Reference | URL |
|---------|---------------|-----|
| **Supabase project** | `ckglxxqncffjszmcntuu` | Linked via `npx supabase` CLI |
| **Render service** | `srv-d6ksj5fgi27c73bjllkg` | whatsapp-agent-rl0k.onrender.com |
| **Render workspace** | `tea-d6k1r77gi27c73ck01l0` | — |
| **Vercel project** | Auto-linked | guyderi2 account |

## How to Deploy — MANDATORY after every change

### 1. Vercel (Next.js frontend + API)
```bash
# Option A: Auto-deploy via git push (preferred)
git push origin main
# Vercel auto-deploys from main. Done.

# Option B: Manual deploy (if needed)
npx vercel --prod --yes
```

### 2. Render (Session Manager)
Render auto-deploys from git push to main. If you need to check status or trigger manually:
```bash
# Use MCP tools — NOT CLI:
# - mcp__render__list_deploys(serviceId: "srv-d6ksj5fgi27c73bjllkg")
# - mcp__render__get_deploy(serviceId: "srv-d6ksj5fgi27c73bjllkg", deployId: "...")
# - mcp__render__list_logs(resource: ["srv-d6ksj5fgi27c73bjllkg"])
```

### 3. Supabase (Database migrations)
```bash
# Push pending migrations to production
npx supabase db push

# It will prompt Y/n — answer automatically via:
echo "Y" | npx supabase db push

# Verify migration applied:
npx supabase migration list
```

### 4. Full Deploy Checklist (run ALL of these after any change)
```bash
# 1. Build check
cd session-manager && npx tsc --noEmit
cd .. && npx next build

# 2. Git commit & push (triggers Vercel + Render auto-deploy)
git add <files>
git commit -m "message"
git push origin main

# 3. DB migrations (if any new .sql files in supabase/migrations/)
npx supabase db push

# 4. Verify deploys — SEE POST-DEPLOY VERIFICATION BELOW
```

### 5. Post-Deploy Verification — MANDATORY after EVERY deploy

After every `git push`, you MUST verify the deploy succeeded. Never assume success.

**Render (Session Manager):**
```
# 1. Wait ~2 minutes for build + deploy
# 2. Check deploy status:
mcp__render__list_deploys(serviceId: "srv-d6ksj5fgi27c73bjllkg", limit: 3)
# → Verify latest deploy status is "live" (not "build_failed" or "update_failed")

# 3. Check startup logs for errors:
mcp__render__list_logs(resource: ["srv-d6ksj5fgi27c73bjllkg"], limit: 30)
# → Must see: "WhatsApp Session Manager running on http://0.0.0.0:PORT"
# → Must see: "Waiting 10s before restoring sessions"
# → Must NOT see: uncaught exceptions, crash loops, or "Error" in startup

# 4. If WhatsApp was connected, verify session restored:
mcp__render__list_logs(resource: ["srv-d6ksj5fgi27c73bjllkg"], text: ["restore"], limit: 10)
# → Should see: "Restoring N session(s)..." or "No sessions to restore"
# → If restoring, must see: "Connection opened" (not repeated crash/reconnect)

# 5. Check for anti-ban health:
mcp__render__list_logs(resource: ["srv-d6ksj5fgi27c73bjllkg"], text: ["Anti-ban"], limit: 5)
```

**Vercel (Next.js):**
- `git push` output shows the deploy URL — verify no build errors
- If build fails, Vercel keeps the previous deploy live (no downtime)

**Supabase (Migrations):**
```bash
npx supabase migration list
# → All migrations should show "Applied"
```

**If any deploy fails:**
1. Read the error logs immediately
2. Fix the issue
3. Re-deploy
4. NEVER leave a failed deploy unresolved

## Monitoring & Logs

### Render Logs (Session Manager)
```bash
# Use MCP tool:
# mcp__render__list_logs(resource: ["srv-d6ksj5fgi27c73bjllkg"], text: ["error"], limit: 50)
# mcp__render__list_logs(resource: ["srv-d6ksj5fgi27c73bjllkg"], text: ["shutdown"], limit: 20)
```

### Supabase SQL (direct queries)
```bash
npx supabase db execute --sql "SELECT count(*) FROM tenants"
# Or use mcp__claude_ai_Supabase__execute_sql(project_id: "ckglxxqncffjszmcntuu", query: "...")
```

## Environment Variables Checklist

When adding a new env var:
1. Add to `.env.local` (gitignored)
2. Add to `.env.local.example` (committed)
3. Add to Vercel project settings (for Next.js app)
4. Add to Render service env vars (for session-manager) — use MCP: `mcp__render__update_environment_variables`
5. **Do NOT ask the user to add env vars** — use the tools above

## Session Manager Process Management

```bash
# Dev (local)
cd session-manager && npm run dev

# Production: Render handles this automatically
# Build: npm run build (configured in Render)
# Start: node dist/server.js (configured in Render)
```

## Key Monitoring Points

- Memory usage of session-manager (Baileys leaks if many tenants)
- Cron job completion (learning engine — runs every 6h by default)
- Supabase connection pool (don't exceed limits)
- Vercel function timeout (30s default — long AI calls may timeout)

## Vercel Timeout Workaround

For endpoints that call DeepSeek AI (learning engine, manual triggers):
- Increase to 60s in `next.config.ts`
- Or move to background job in session-manager via cron

## Positive Pattern (2026-02-27)
[Score: 8/10] For domain rebranding tasks, always request current domain and hosting details first, and ensure color variables align with the brand guidelines provided by UX.

## Positive Pattern (2026-02-27)
[Score: 7/10] When updating documentation for rebranding, provide cross-platform commands for text replacement and include meta tag updates for social media consistency.

## Positive Pattern (2026-03-05)
[Score: 7/10] When checking Node.js versions, tailor recommendations to the exact version found rather than generic version ranges. Verify project stack details before making compatibility statements.

## Coordination Rules — 2026-03-13
- You own: Vercel config, Render deployment, CI/CD — not application code
- Work in parallel with other agents on infrastructure while they work on code

## Lessons — 2026-03-17 (updated)
- **NEVER ask user to deploy or run migrations** — do it yourself with the tools above
- Vercel: auto-deploys from `git push origin main` — no manual step needed
- Render: auto-deploys from `git push origin main` — service ID: `srv-d6ksj5fgi27c73bjllkg`
- Render MCP tools: `list_deploys`, `list_logs`, `get_deploy`, `update_environment_variables`
- Supabase: `npx supabase db push` applies pending migrations — CLI is authenticated
- Supabase project ref: `ckglxxqncffjszmcntuu` — linked in the repo
- Always `npx tsc --noEmit` + `npx next build` before pushing
- Always verify deploy succeeded — check Render logs via MCP, Vercel via git push output
- Deploy order: build check → git push (Vercel+Render) → supabase db push (if migrations)

## Infrastructure Changes — 2026-03-17

### New Environment Variable
- `SESSION_ENCRYPTION_KEY` — required on Render for encrypted creds backup (AES-256-GCM)
- Without this, WhatsApp sessions won't auto-reconnect after deploys
- Must be set as a secret in Render service environment

### New Files
- `session-manager/src/antiban.ts` — anti-ban protection module (health monitoring, gaussian jitter, presence pause)
- `supabase/migrations/20260316130000_add_whatsapp_creds_backup.sql` — new `whatsapp_creds_backup` table

### Auto-Reconnect After Deploy
- BEFORE: every deploy disconnected WhatsApp — creds were wiped by `clearAuthState` and no backup existed
- AFTER: creds are encrypted and backed up to `whatsapp_creds_backup` table; `restoreAllSessions()` checks this table on startup
- Signal protocol keys (pre-keys, sender keys, sessions) are also backed up — prevents PreKeyError after restore

### New API Endpoint
- `GET /sessions/:tenantId/health` — returns anti-ban health status (risk level, score, disconnect count, failed messages)

### Deleted Files
- `src/app/api/webhook/route.ts` — legacy pre-multi-tenant webhook, replaced by session-manager message handling

## Production Security Hardening Deploy — 2026-03-17

### What was deployed
Commit `f83394a` — security hardening + anti-ban improvements. Pushed to GitHub → Vercel auto-deploy + manual Render deploy triggered.

### New/Updated Environment Variables
- `OAUTH_STATE_SECRET` — optional, falls back to `SUPABASE_SERVICE_ROLE_KEY`. Used for HMAC-signing OAuth state parameters. Recommend setting a dedicated value for easier key rotation.
- `SESSION_ENCRYPTION_KEY` — now **loudly warns** on startup if missing, and `saveCredsBackup()` **throws** instead of silently skipping. Must be set on Render.

### Changes affecting deployment
- OAuth routes now require auth — users must be logged in to initiate Google/Outlook OAuth. No infra change needed, but note that unauthenticated OAuth flows will now return 401.
- Anti-ban: unique browser fingerprint per tenant — deterministic, no config needed. Each tenant auto-gets a different browser string from a pool of 6 options.
- Global rate limit (25 msgs/min) is in-memory per process — resets on restart. Acceptable for single-instance session-manager.

## Improvement Note (2026-03-14)
[Score: 1/10] For frontend Supabase Realtime tasks, DevOps typically only needs to ensure: 1) Supabase project has Realtime enabled, 2) WebSocket connections are allowed in firewall rules, 3) No deployment conflicts with existing subscriptions.

## Positive Pattern (2026-03-15)
[Score: 10/10] This agent should remember that when providing environment variable instructions, it's helpful to mention security best practices (marking as secrets, using Render's secret management features) and to suggest incremental testing approaches.

## Improvement Note (2026-03-15)
[Score: 2/10] When analyzing logs, first verify log file locations exist and are readable. If logs are missing or unreadable, report this immediately with specific paths checked rather than timing out.

## Improvement Note (2026-03-17)
[Score: 2/10] For log analysis tasks, start with specific log query patterns (e.g., error codes, session IDs) rather than broad exploration to avoid iteration limits.

## Positive Pattern (2026-03-17)
[Score: 9/10] When checking deployment environments, also verify corresponding service configurations (like Supabase dashboard) for complete picture.

## Voice Channel Infrastructure — 2026-03-29

### New Environment Variables (must be set on Vercel):
- `ELEVENLABS_API_KEY` — ElevenLabs API access for voice agent creation/management
- `TWILIO_ACCOUNT_SID` — Twilio account ID for SMS
- `TWILIO_AUTH_TOKEN` — Twilio auth for SMS sending
- `TWILIO_FROM_NUMBER` — Twilio phone number (source for outgoing SMS)

### New DB Migration:
- `supabase/migrations/20260329100000_voice_channel.sql` — adds voice columns to tenants, creates voice_catalog and call_logs tables

### Architecture Note:
- Voice channel runs entirely in Vercel serverless (Next.js API routes) — no session-manager involvement
- ElevenLabs manages the voice AI agent (hosted by them)
- Twilio provides phone numbers and routes calls to ElevenLabs
- SMS sending happens via webhook: ElevenLabs → our webhook → Twilio

### Deploy Checklist for Voice:
1. Set env vars on Vercel (4 new vars above)
2. Run `npx supabase db push` for the voice migration
3. Populate `voice_catalog` table with available ElevenLabs voices
4. Configure Twilio webhook URLs if needed

## Baileys Service — 2026-03-22
- **Render service ID**: `srv-d6uko0ndiees73chbe7g` (separate from session-manager `srv-d6ksj5fgi27c73bjllkg`)
- Anti-ban fixes deployed: read receipts, identical message blocking, risk score tracking, markOnlineOnConnect: false
- AI agent unification deployed: 14 Hebrew rules, 40-min gap detection, 20-message history