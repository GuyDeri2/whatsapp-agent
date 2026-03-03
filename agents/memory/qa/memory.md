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