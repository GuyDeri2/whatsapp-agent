# DevOps Memory

## Infrastructure Overview

- **Frontend + API**: Vercel (automatic deploys on push to main)
- **Session Manager**: Needs dedicated always-on server (VPS/cloud VM)
  - Can't run on Vercel (serverless, stateless — Baileys needs persistent WebSocket)
  - Run with PM2: `pm2 start dist/server.js --name whatsapp-session-manager`
- **Database**: Supabase managed (no infra needed)

## Environment Variables Checklist

When adding a new env var:
1. Add to `.env.local` (gitignored)
2. Add to `.env.local.example` (committed)
3. Add to Vercel project settings (for Next.js app)
4. Add to server `.env.local` (for session-manager)

## Session Manager Process Management

```bash
# Dev
cd session-manager && npm run dev

# Production (PM2)
cd session-manager && npm run build
pm2 start dist/server.js --name session-mgr --restart-delay=3000
pm2 save
pm2 startup
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

## Lessons — 2026-03-13
- Vercel: use `npx vercel --prod --yes` — project is already linked
- Render: use REST API with $RENDER_API_KEY — find service ID first, then deploy
- Always verify deploy succeeded after triggering — don't assume success
- Env vars needed for CLI: VERCEL_TOKEN, RENDER_API_KEY, SUPABASE_ACCESS_TOKEN
- Run `npm run build` before any Vercel deploy to catch errors early