# QA Memory

## Critical Test Scenarios (Always Cover)

1. **Multi-tenant isolation** — tenant A cannot access tenant B's data
2. **Filter mode transitions** — all → whitelist → blacklist → all
3. **Agent mode transitions** — active ↔ learning ↔ paused
4. **Hebrew message handling** — RTL text, Unicode, emojis
5. **Phone number formats** — 972x vs 0x vs +972x
6. **Long messages** — AI should truncate / handle gracefully
7. **Duplicate message events** — Baileys may fire twice for same message

## Test Setup Pattern

```typescript
// Mock Supabase
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: mockTenant, error: null }),
  })),
}));

// Mock OpenAI/DeepSeek
jest.mock('openai', () => ({
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: 'Mock AI response' } }],
        }),
      },
    },
  })),
}));
```

## Acceptance Criteria Template

- [ ] Happy path works as expected
- [ ] Error states display correctly (network error, API error, empty data)
- [ ] Multi-tenant isolation verified (cross-tenant access blocked)
- [ ] Loading state shown during async operations
- [ ] Mobile layout works (min-width: 320px)
- [ ] Hebrew text renders correctly (RTL)

## Positive Pattern (2026-02-27)
[Score: 9/10] Always include performance testing scenarios for chat interfaces, especially for infinite scroll and large conversation histories.

## Positive Pattern (2026-02-27)
[Score: 9/10] For rebranding QA, always include multi-tenant isolation tests and RTL language support checks, as these are critical for maintaining core functionality.

## Positive Pattern (2026-02-27)
[Score: 9/10] For testing real-time features, simulate network interruptions and reconnection scenarios to ensure the UI handles them gracefully (e.g., showing 'Reconnecting...' state, syncing missed messages).

## Positive Pattern (2026-02-27)
[Score: 9/10] When testing real-time sync bugs, always include timing-based tests that simulate rapid UI interactions and network delays. The race condition simulation test pattern is particularly valuable for this class of bugs.

## Positive Pattern (2026-03-01)
[Score: 9/10] Include integration tests for database triggers and real-time subscriptions to ensure end-to-end functionality.

## Positive Pattern (2026-03-02)
[Score: 9/10] Always test the exact WhatsApp hierarchy: saved contact → push name → phone number. Include tests for concurrent real-time updates across multiple browser tabs.

## Coordination Rules — 2026-03-13
- Run after fix agents complete — verify their changes don't break existing behaviour
- Check: does the fix handle edge cases? Does it maintain tenant isolation?

## Lessons — 2026-03-13
- Test message limit: verify chat still shows correct order after .limit(100) + JS reverse
- Test React.memo: verify components still update when their actual props change
- Test cache invalidation: verify tenant config cache clears when settings change
- N+1 fix: verify batch query returns correct "previous message" for each handoff

## New Test Scenarios — 2026-03-17

### Anti-Ban Module (`antiban.ts`)
- Test `gaussianRandom(min, max)`: all values must fall within [min, max], distribution should cluster around midpoint
- Test `getHumanDebounceDelay()`: verify night hours (23:00-07:00 Israel) produce 3x longer delays
- Test health scoring: `onDisconnect` with 403 adds 40pts, with 401 adds 60pts, normal adds 15pts
- Test score decay: score should decrease by 2 per minute when no events
- Test risk level transitions: 0-29=low, 30-59=medium, 60-84=high, 85-100=critical
- Test `startPresencePauseScheduler`: verify it calls sendPresence("unavailable") then later sendPresence("available")
- Test `onMessageFailed`: verify it increments score by 20

### LID Conversation Splitting
- Test: message from LID JID (≥15 digit number) → verify deferred fix runs after 3s
- Test: `clearAuthState()` preserves `lid_*` and `contacts` rows in whatsapp_sessions
- Test: LID sweep SQL filter — `.like("phone_number", "_______________%" )` correctly matches ≥15 char strings
- Test: connection guard — deferred LID fix should NOT run if session disconnected during 3s wait

### Encrypted Creds Backup
- Test: `saveCredsBackup()` skips when no `SESSION_ENCRYPTION_KEY`
- Test: `saveCredsBackup()` → `restoreCredsFromBackup()` round-trip preserves creds and signal keys
- Test: `clearSessionData()` deletes backup from `whatsapp_creds_backup` table
- Test: `clearAuthState()` does NOT delete backup (only `clearSessionData` does)

### Read Receipts
- Test: `socket.readMessages()` called on every incoming message (not outgoing)
- Test: read receipt failure is non-fatal (caught and ignored)

### Webhook Route Deletion
- Test: `src/app/api/webhook/route.ts` no longer exists
- Test: no references to `/api/webhook` in frontend code

## Production Security Hardening Tests — 2026-03-17

### OAuth HMAC State
- Test: initiate OAuth without auth → should return 401
- Test: initiate OAuth for tenant user doesn't own → should return 403
- Test: callback with tampered state (wrong HMAC sig) → should redirect with error
- Test: callback with expired state (>10min old) → should redirect with error
- Test: callback with valid state → should succeed and link calendar

### getSession → getUser Migration
- Test: send request with expired JWT cookie to messages/contacts routes → should return 401 (previously would have succeeded with getSession)
- Test: valid user accessing own tenant → still works

### Sessions GET Auth
- Test: user A tries to GET session status of user B's tenant → should return 404
- Test: user A GETs own tenant session → should succeed

### SSRF Protection
- Test: set lead_webhook_url to `http://127.0.0.1:8080/steal` → should return 400 "private address"
- Test: set lead_webhook_url to `http://10.0.0.1/internal` → should return 400
- Test: set lead_webhook_url to valid external URL → should succeed

### Anti-Ban Improvements
- Test: `getBrowserForTenant(tenantId)` returns same browser for same tenantId across calls (deterministic)
- Test: `getBrowserForTenant("a")` ≠ `getBrowserForTenant("b")` for different tenantIds (most cases)
- Test: `getGlobalSendDelay()` returns 0 for first 25 calls, then >0 for the 26th
- Test: read receipt `setTimeout` delay is 1000-3000ms range

## Improvement Note (2026-03-14)
[Score: 1/10] For testing Supabase Realtime: 1) Test subscription/unsubscription lifecycle, 2) Verify UI updates on INSERT/UPDATE/DELETE events, 3) Test network disconnection recovery, 4) Verify tenant isolation in subscriptions.

## Improvement Note (2026-03-15)
[Score: 2/10] For contact_name bug verification, prepare test cases for outgoing messages from owner's phone vs. interface before deep tool analysis to prevent iteration limits.

## Improvement Note (2026-03-15)
[Score: 2/10] QA agents should focus on validation and testing methodologies even when other agents fail. Propose specific test cases for connection issues rather than waiting for others' outputs.

## Positive Pattern (2026-03-17)
[Score: 7/10] When asked to investigate and fix, balance test planning with immediate debugging suggestions. Connect test scenarios to likely root causes (e.g., 'Test credential cleanup failures might indicate issues in clearAuthState').

## Positive Pattern (2026-03-17)
[Score: 8/10] When creating test cases for OAuth flows, include configuration validation tests (e.g., 'Test: Missing environment variables returns appropriate error').