# Frontend Skills & Patterns

## Next.js 16 App Router Patterns

### Server vs Client Components
```tsx
// Server Component (default) — data fetching, no interactivity
export default async function TenantPage({ params }: { params: { id: string } }) {
  const supabase = await createServerClient()
  const { data } = await supabase.from('tenants').select('*').eq('id', params.id).single()
  return <TenantDashboard tenant={data} />
}

// Client Component — event handlers, hooks, real-time
'use client'
export function TenantDashboard({ tenant }: { tenant: Tenant }) {
  const [activeTab, setActiveTab] = useState('chat')
  // ...
}
```

### Async Data in Client Components
```tsx
'use client'
export function ContactsList({ tenantId }: { tenantId: string }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/tenants/${tenantId}/contacts`)
      .then(r => r.json())
      .then(data => setContacts(data))
      .catch(() => setError('Failed to load contacts'))
      .finally(() => setLoading(false))
  }, [tenantId])

  if (loading) return <div className={styles.loading}>Loading...</div>
  if (error) return <div className={styles.error}>{error}</div>
  if (!contacts.length) return <div className={styles.empty}>No contacts yet</div>
  return <ul>{contacts.map(c => <ContactItem key={c.id} contact={c} />)}</ul>
}
```

---

## CSS Modules Pattern

```css
/* ContactsList.module.css */
.container { padding: 1rem; }
.loading { color: var(--gray-400); text-align: center; padding: 2rem; }
.error { color: var(--red-500); padding: 1rem; border-radius: 8px; background: var(--red-50); }
.empty { color: var(--gray-400); text-align: center; padding: 2rem; }
```

```tsx
import styles from './ContactsList.module.css'
// Use: className={styles.container}
```

**Never use inline styles** — always CSS Modules or globals.css variables.

---

## WhatsApp Design Language

```css
/* globals.css variables */
--wa-green: #25D366;
--wa-dark-green: #128C7E;
--wa-light-green: #DCF8C6;  /* outgoing message bubble */
--wa-blue: #34B7F1;          /* read receipt checkmarks */
```

**Chat bubble pattern:**
```tsx
<div className={`${styles.message} ${msg.role === 'user' ? styles.incoming : styles.outgoing}`}>
  <p>{msg.content}</p>
  <span className={styles.time}>{formatTime(msg.created_at)}</span>
</div>
```

---

## Form Handling

```tsx
'use client'
export function AgentSettingsForm({ tenant }: { tenant: Tenant }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    const form = new FormData(e.currentTarget)

    const res = await fetch(`/api/tenants/${tenant.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_prompt: form.get('agent_prompt') }),
    })

    setSaving(false)
    if (res.ok) setSaved(true)
    else alert('Failed to save')
  }

  return (
    <form onSubmit={handleSubmit}>
      <textarea name="agent_prompt" defaultValue={tenant.agent_prompt} />
      <button type="submit" disabled={saving}>
        {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
      </button>
    </form>
  )
}
```

---

## Real-Time Polling

```tsx
useEffect(() => {
  const fetchMessages = () => {
    fetch(`/api/tenants/${tenantId}/messages`)
      .then(r => r.json())
      .then(setMessages)
  }
  fetchMessages()
  const interval = setInterval(fetchMessages, 3000) // Poll every 3s
  return () => clearInterval(interval)
}, [tenantId])
```

---

## TypeScript Interface Patterns

```typescript
interface Tenant {
  id: string
  business_name: string
  agent_mode: 'learning' | 'active' | 'paused'
  agent_filter_mode: 'all' | 'whitelist' | 'blacklist'
  whatsapp_phone: string | null
}

interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'owner'
  content: string
  is_from_agent: boolean
  created_at: string
}
```
