# QA Skills & Patterns

## Test Case Table Format

| Scenario | Input | Expected Output | Edge Case? |
|----------|-------|-----------------|------------|
| Valid request, owner | Authenticated user, correct tenant_id | 200 + data | No |
| Unauthenticated | No auth cookie | 401 Unauthorized | No |
| Wrong tenant | User A accessing Tenant B's data | 403 Forbidden | **Yes** |
| Empty input | Empty string body | 400 Bad Request | No |
| Max length exceeded | 5001 char agent_prompt | 400 Bad Request | **Yes** |
| Concurrent requests | 10 simultaneous inserts | All succeed, no duplicates | **Yes** |

---

## Jest Test Pattern

```typescript
// src/app/api/tenants/[id]/__tests__/route.test.ts
import { GET } from '../route'
import { createServerClient } from '@/lib/supabase/server'

jest.mock('@/lib/supabase/server')

const mockSupabase = {
  auth: { getUser: jest.fn() },
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(createServerClient as jest.Mock).mockResolvedValue(mockSupabase)
})

test('returns 401 when unauthenticated', async () => {
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

  const req = new Request('http://localhost/api/tenants/123')
  const res = await GET(req, { params: { id: '123' } })

  expect(res.status).toBe(401)
})

test('returns 403 when user does not own tenant', async () => {
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-a' } } })
  mockSupabase.single.mockResolvedValue({ data: null, error: { message: 'Not found' } })

  const req = new Request('http://localhost/api/tenants/tenant-b')
  const res = await GET(req, { params: { id: 'tenant-b' } })

  expect(res.status).toBe(403)
})
```

---

## Multi-Tenant Isolation Tests

These are **required** for any feature that touches the database:

```typescript
describe('Tenant isolation', () => {
  test('Tenant A cannot read Tenant B conversations', async () => {
    // Setup: create two tenants, insert conversation under tenant B
    // Act: make API call authenticated as tenant A's user, for tenant B's conversation
    // Assert: 403 or 404 response, never 200 with data
  })

  test('Tenant A cannot write to Tenant B knowledge base', async () => {
    // Setup: two tenants
    // Act: POST /api/tenants/{tenantB.id}/knowledge with user A's auth
    // Assert: 403
  })
})
```

---

## Agent Mode Transition Tests

```typescript
describe('Agent mode transitions', () => {
  test('active → paused: no AI reply sent', async () => { ... })
  test('paused → learning: owner replies are logged but AI stays silent', async () => { ... })
  test('learning → active: AI starts responding', async () => { ... })
})
```

---

## Message Deduplication Test

```typescript
test('duplicate Baileys event does not create duplicate messages', async () => {
  const messageId = 'WA_MSG_123'

  // Simulate same message delivered twice
  await handleIncomingMessage(tenantId, { key: { id: messageId }, ... })
  await handleIncomingMessage(tenantId, { key: { id: messageId }, ... })

  const { data: messages } = await supabase
    .from('messages')
    .select('id')
    .eq('wa_message_id', messageId)

  expect(messages?.length).toBe(1) // Not 2
})
```

---

## Acceptance Criteria Template (DoD)

```markdown
## Definition of Done — [Feature Name]

### Functional
- [ ] Happy path works end-to-end
- [ ] Error states return correct HTTP codes
- [ ] Data is correctly persisted to Supabase

### Security
- [ ] Unauthenticated requests return 401
- [ ] Cross-tenant access returns 403
- [ ] Input validated server-side

### Performance
- [ ] API responds within 500ms under normal load
- [ ] No N+1 database queries introduced

### Testing
- [ ] Unit tests cover happy path + auth failure + tenant isolation
- [ ] E2E test covers main user flow (if UI change)
- [ ] Existing tests still pass
```
