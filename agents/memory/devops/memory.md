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
