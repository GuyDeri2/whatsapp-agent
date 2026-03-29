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

---

## ElevenLabs Conversational AI Integration

### Agent Creation & Config
```typescript
// src/lib/elevenlabs.ts — ElevenLabs API client
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const BASE_URL = "https://api.elevenlabs.io";

// Create agent → returns agent_id, saved to tenants.elevenlabs_agent_id
async function createAgent(config: AgentConfigParams): Promise<string>;
// Update agent config (voice, prompt, tools, KB refs)
async function updateAgent(agentId: string, config: Partial<AgentConfigParams>): Promise<void>;
// Sync all KB docs to agent's knowledge base references
async function syncKnowledgeBase(agentId: string, docIds: string[]): Promise<void>;
// Create/delete individual KB documents
async function createKBDocument(name: string, text: string): Promise<string>; // returns doc_id
async function deleteKBDocument(docId: string): Promise<void>;
```

### Two-Layer Voice Config Pattern
```
Layer 1 (Platform — immutable, in voice-platform-config.ts):
  - Hebrew pronunciation rules, gender-aware grammar
  - Tool definitions (send_sms via webhook)
  - Safety boundaries, response length limits

Layer 2 (Business owner — customizable, in DB):
  - Business name, greeting, custom instructions
  - Voice selection (from voice_catalog)
  - KB content (synced to ElevenLabs)
```

### Gender-Aware System Prompt
```typescript
// src/lib/voice-platform-config.ts
function buildSystemPrompt(gender: "male" | "female"): string {
  // Hebrew verb conjugation changes by gender:
  // male: "אתה מזכיר AI", "אמור", "ענה"
  // female: "את מזכירה AI", "אמרי", "עני"
}
```

### KB Sync to ElevenLabs (CRITICAL PATTERN)
```
ElevenLabs KB docs CANNOT be updated in-place. Pattern:
1. Delete old doc (by elevenlabs_kb_id)
2. Create new doc with updated content
3. Update elevenlabs_kb_id in knowledge_base row
4. Call syncKnowledgeBaseToAgent() to update agent references
```

---

## Twilio SMS Integration

```typescript
// src/lib/twilio.ts — Lazy-initialized singleton
import Twilio from "twilio";

let client: Twilio.Twilio | null = null;
function getClient(): Twilio.Twilio {
  if (!client) client = Twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  return client;
}

// Phone numbers must include country code without +
async function sendSms(to: string, body: string): Promise<void> {
  await getClient().messages.create({ to: `+${to}`, from: process.env.TWILIO_FROM_NUMBER!, body });
}
```

---

## Voice Webhook (ElevenLabs Tools)

```typescript
// src/app/api/webhooks/elevenlabs-tools/[tenantId]/route.ts
// Validates x-webhook-secret header against tenant's voice_webhook_secret
// Executes tool calls from ElevenLabs (e.g., send_sms)
// Uses supabaseAdmin (service role) — no user auth needed for webhooks
```

---

## Voice API Routes

```
GET  /api/tenants/[tenantId]/voice          → Read voice settings
PATCH /api/tenants/[tenantId]/voice         → Update settings + sync to ElevenLabs
POST /api/tenants/[tenantId]/voice/setup    → Create ElevenLabs agent for tenant
GET  /api/tenants/[tenantId]/voice/catalog  → List voices from voice_catalog table
POST /api/tenants/[tenantId]/voice/kb-sync  → Sync KB change to ElevenLabs
POST /api/webhooks/elevenlabs-tools/[tenantId] → ElevenLabs tool webhook (SMS)
```
