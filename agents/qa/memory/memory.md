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