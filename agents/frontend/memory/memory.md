# Frontend Memory

## Established Patterns

- Dashboard tabs: ConnectTab, SettingsTab, CapabilitiesTab, ChatTab, ContactsTab — all in `src/components/tenant/`
- Global layout in `src/app/layout.tsx` — dark background, WhatsApp green accent
- Auth handled via Supabase SSR — use `createServerClient` for server components
- All async data fetching uses Next.js Server Components by default
- Client-side interactivity → 'use client' + useEffect + useState

## CSS Conventions

- WhatsApp green: `#25D366` (buttons, active states)
- Dark background: `#111b21` (chat area)
- Light bubble: `#d9fdd3` (outgoing)
- Dark bubble: `#202c33` (incoming)
- Border radius: `0.5rem` for cards, `18px` for chat bubbles
- Font: system font stack

## Component Patterns

- Loading state: `<div className={styles.loading}>טוען...</div>`
- Error state: `<div className={styles.error}>{errorMessage}</div>`
- Empty state: meaningful message + call-to-action button

## RTL Support
- Hebrew text is RTL — use `dir="rtl"` on relevant containers
- Chat messages: RTL for Hebrew, LTR for English — detect with Unicode ranges

## Positive Pattern (2026-02-27)
[Score: 7/10] Always implement real-time subscriptions when building chat interfaces to ensure immediate updates when new messages arrive.

## Positive Pattern (2026-02-27)
[Score: 7/10] When debugging real-time message refresh, always verify the Supabase real-time subscription filter (`filter: conversation_id=eq.${selectedConversationId}`) and ensure the channel is properly cleaned up on component unmount or conversation change.

## Positive Pattern (2026-02-27)
[Score: 9/10] When dealing with real-time data sync, always check selectedConvIdRef patterns and ensure subscription cleanup happens before new subscriptions are created. The isMounted pattern is crucial for preventing memory leaks.

## Positive Pattern (2026-03-01)
[Score: 9/10] When implementing real-time features, ensure the subscription matches the data source (e.g., messages table updates might trigger conversation sorting).

## Positive Pattern (2026-03-02)
[Score: 7/10] Always use TypeScript interfaces for API responses. Phone number formatting should match local user expectations (Israeli format: 050-xxx-xxxx).

## Coordination Rules — 2026-03-13
- You work in parallel with Backend and Database agents — never edit their files
- YOUR files: `src/app/`, `src/components/` — Backend/Database never touch these
- When dispatched alongside other agents, read your task carefully for explicit file list
- Always confirm file ownership before editing to avoid conflicts

## Lessons — 2026-03-13
- `React.memo` should be applied to ALL tab components — they re-render on every parent state change
- `.limit(100)` is mandatory on all Supabase message queries
- `AVATAR_COLORS` and similar constants must be at module level, not inside component body
- `setInterval` must always be stored in a ref and cleaned up in useEffect return
- Polling fallback: 60s is enough when Realtime subscriptions are active (30s was overkill)
- User (Guy) prefers concise diffs — only change what's needed, no extra cleanup