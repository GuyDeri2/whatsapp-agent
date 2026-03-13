# DevOps Skills & Patterns

## Session Manager — Docker Setup

```dockerfile
# session-manager/Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
EXPOSE 3001
CMD ["node", "dist/server.js"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  session-manager:
    build: ./session-manager
    restart: unless-stopped
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
    env_file:
      - ./session-manager/.env.local
    volumes:
      - ./sessions:/app/sessions  # Baileys local session files
```

---

## PM2 Process Management

```bash
# Install PM2
npm install -g pm2

# Start session manager
pm2 start npm --name "session-manager" -- start
pm2 save
pm2 startup  # auto-start on reboot

# Monitor
pm2 status
pm2 logs session-manager
pm2 monit

# Restart with zero downtime
pm2 reload session-manager
```

---

## GitHub Actions CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy session-manager

on:
  push:
    branches: [main]
    paths:
      - 'session-manager/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build
        run: |
          cd session-manager
          npm ci
          npm run build
      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /app/session-manager
            git pull
            npm ci
            npm run build
            pm2 reload session-manager
```

---

## Health Check Pattern

```typescript
// session-manager/src/server.ts
app.get('/health', (req, res) => {
  const activeSessions = sessionManager.getActiveSessionCount()
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeSessions,
    memory: process.memoryUsage(),
  })
})
```

---

## Structured Logging (Pino)

```typescript
import pino from 'pino'

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }
    : undefined,
})

// Usage — structured, not raw strings:
logger.info({ tenantId, event: 'message_received', phone }, 'Incoming message')
logger.error({ tenantId, err }, 'AI generation failed')
// ❌ Don't log: logger.info(`Message: ${message.content}`) — PII leak
```

---

## Environment Variable Validation

```typescript
// session-manager/src/config.ts
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DEEPSEEK_API_KEY']

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`)
    process.exit(1)
  }
}

export const config = {
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  deepseekKey: process.env.DEEPSEEK_API_KEY!,
  port: parseInt(process.env.PORT ?? '3001'),
}
```

---

## Monitoring Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Memory usage | > 70% | > 85% |
| Active sessions | > 80 | > 150 |
| CPU usage | > 60% (sustained) | > 80% |
| Response time /health | > 500ms | > 2000ms |
| Failed reconnects | > 5/min | > 20/min |

---

## Vercel + Render Deployment Patterns

### Deploy Next.js to Vercel (production)
```bash
# From project root
cd "/Users/guyderi/Library/Mobile Documents/com~apple~CloudDocs/whatsapp agent"
npm run build && npx vercel --prod --yes
```

### Deploy session-manager to Render
Render auto-deploys on git push. To trigger manually:
```bash
# Find service ID first
curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  https://api.render.com/v1/services | jq '.[] | select(.service.name | contains("session")) | .service.id'

# Then deploy
curl -s -X POST \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  https://api.render.com/v1/services/<SERVICE_ID>/deploys \
  -H "Content-Type: application/json" -d '{}' | jq .
```

### Check if deploy succeeded
```bash
# Vercel
npx vercel ls --limit 3

# Render — poll until status is "live"
curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  https://api.render.com/v1/services/<SERVICE_ID>/deploys?limit=1 | jq '.[0].deploy.status'
```
