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