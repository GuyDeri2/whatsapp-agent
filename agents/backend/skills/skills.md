# Backend Skills & Patterns

## Next.js API Route Pattern

```typescript
// src/app/api/tenants/[id]/route.ts
import { createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)  // ← tenant isolation
    .single()

  if (error || !tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(tenant)
}
```

---

## Supabase Patterns

### Service Role (session-manager only)
```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

### Always Check Errors
```typescript
const { data, error } = await supabase.from('messages').insert({ ... })
if (error) {
  console.error('Insert failed:', error.message)
  throw new Error(error.message)
}
```

---

## RLS Policy Pattern

```sql
-- Every new table needs:
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their tenant's knowledge"
ON knowledge_base FOR ALL
USING (
  tenant_id IN (
    SELECT id FROM tenants WHERE user_id = auth.uid()
  )
);
```

---

## Baileys Integration

```typescript
// session-manager/src/session-manager.ts
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'

async function createSession(tenantId: string) {
  const { state, saveCreds } = await useMultiFileAuthState(`sessions/${tenantId}`)

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  })

  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      if (!msg.key.fromMe) handleIncomingMessage(tenantId, msg)
    }
  })

  return sock
}
```

---

## DeepSeek AI Integration

```typescript
// session-manager/src/ai-agent.ts
import OpenAI from 'openai'

const ai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: 'https://api.deepseek.com',
})

async function generateReply(systemPrompt: string, userMessage: string): Promise<string> {
  const completion = await ai.chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 500,
    temperature: 0.7,
  })
  return completion.choices[0]?.message?.content?.trim() ?? ''
}
```

---

## Multi-Tenant Message Flow

```
Incoming WA message
  → session-manager receives via Baileys socket
  → look up tenant by phone_number
  → check agent_mode (learning/active/paused)
  → check contact_rules (allow/block)
  → if active: call DeepSeek with tenant's agent_prompt + knowledge_base
  → store message in DB (messages table)
  → if active: send AI reply via Baileys
```

---

## Input Validation Pattern

```typescript
// Always validate at the API boundary
const { business_name, agent_prompt } = await req.json()

if (!business_name || typeof business_name !== 'string' || business_name.length > 255) {
  return NextResponse.json({ error: 'Invalid business_name' }, { status: 400 })
}

if (agent_prompt && agent_prompt.length > 5000) {
  return NextResponse.json({ error: 'agent_prompt too long (max 5000 chars)' }, { status: 400 })
}
```
