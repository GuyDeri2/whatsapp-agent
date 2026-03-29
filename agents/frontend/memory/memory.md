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

## Changes — 2026-03-17

### handoff_collect_email Setting
- Added `handoff_collect_email: boolean` to `Tenant` interface in `page.tsx`
- Added to `editForm` initial state (default: `false`)
- Removed `(data as any).handoff_collect_email` cast — now properly typed
- Toggle UI added in SettingsTab.tsx (copy-paste of existing toggle pattern)

### Webhook Route Deleted
- `src/app/api/webhook/route.ts` was deleted (legacy code, no tenant isolation)
- `.next` cache may need clearing after this deletion (`rm -rf .next`)

### Anti-Ban Health Endpoint Available
- `GET /sessions/:tenantId/health` returns `{ risk, score, disconnects, failedMessages }`
- Can be used in dashboard to show WhatsApp connection health status to tenant owners
- Risk levels: low/medium/high/critical

## Production Security Hardening (Frontend Impact) — 2026-03-17

### OAuth Flow Change
- OAuth initiation (`/api/oauth/google` and `/api/oauth/outlook`) now requires authenticated user with tenant ownership.
- If user is not logged in, OAuth will return 401. Frontend should ensure user is authenticated before starting OAuth flow.
- No UI changes needed — the existing flow already requires login.

### API Auth Hardened
- All API routes (`messages`, `contacts`, `sessions`) now use `getUser()` instead of `getSession()`.
- Expired sessions will now correctly return 401 instead of being silently accepted.
- Frontend should handle 401 responses by redirecting to login.

### Anti-Ban Health Dashboard (Available)
- `GET /sessions/:tenantId/health` now includes additional info: unique browser fingerprint name, global rate limit status.
- Can be shown in ConnectTab or a new health widget for tenant owners.

## Improvement Note (2026-03-14)
[Score: 2/10] When implementing Supabase Realtime subscriptions in Next.js, ensure the agent can access and analyze the relevant source files (page.tsx, CapabilitiesTab.tsx, LeadsTab.tsx, CalendarTab.tsx) to understand existing patterns before attempting modifications.

## Positive Pattern (2026-03-17)
[Score: 7/10] For OAuth issues, always check the actual Supabase dashboard configuration and test the flow end-to-end before reporting assumptions.

## AI Agent Unification — 2026-03-22
- All 3 AI agents now share the same 14 Hebrew rules and behavior
- Frontend doesn't call AI directly, but should know: max_tokens is 300 for real-time replies, 20-message history with 40-min gap detection
- No frontend changes needed for this unification

## Frontend Audit — 2026-03-22

### Bugs Fixed
- **`createClient()` instability**: `createClient()` returns a new instance per render. Using it as a useEffect dependency causes infinite re-renders. Fix: use `useRef(createClient())` for stable references. Found in CapabilitiesTab (causing re-fetches), login page (re-loading Google SDK script).
- **`dir="ltr text-right"`** in ContactsTab: `dir` attribute contained a CSS class by mistake. Split into `dir="ltr"` + `className="text-right"`.
- **Identical ternary branches** in CapabilitiesTab: `learning.source === "manual" ? "bg-emerald-500/50" : "bg-emerald-500/50"` — both branches identical, so learned vs manual items looked the same. Fixed learned items to use blue color.
- **`(data as any).owner_phone` and `agent_respond_to_saved_contacts`**: `owner_phone` and `lead_webhook_url` were missing from Tenant interface, forcing unsafe `as any` casts. Added to interface.
- **`getSession()` deprecation**: Landing page used `getSession()` instead of `getUser()` per security hardening requirements.
- **Missing error handling**: Dashboard `handleCreate` had no error feedback on failure.

### Dead Code Removed
- `qrPollingRef` — leftover from Baileys QR polling era, never used.

### Type Safety Improvements
- CapabilitiesTab: `tenant: any` -> `{ id: string }`
- LeadsTab: `tenant: any` -> `{ id: string; lead_webhook_url?: string | null }`
- CalendarTab: `tenant: any` -> `{ id: string }`
- SettingsTab: `setEditForm: React.Dispatch<React.SetStateAction<any>>` -> properly typed EditForm

### Lessons Learned
- ALWAYS use `useRef(createClient())` for Supabase client in client components — never call `createClient()` at component level and use it in dependency arrays
- Watch for identical ternary branches — they indicate a copy-paste bug where differentiation was intended
- `dir` HTML attribute only accepts "ltr"/"rtl"/"auto" — never put CSS classes in it

## Website Intelligence Feature — 2026-03-22

### What Was Built
- Added Website Intelligence section to SettingsTab (URL input + scan button + results preview)
- New fields on Tenant interface: `website_url`, `website_last_crawled_at`
- SettingsTab now accepts optional `onTenantUpdate` callback prop for refreshing tenant data after crawl
- API endpoints used: `POST /api/tenants/[tenantId]/website-crawl` and `POST /api/tenants/[tenantId]/website-crawl/apply`

### Patterns
- When adding a new section to SettingsTab, keep it inside the `flex-1 order-2 lg:order-1` column div (not outside it) — otherwise JSX nesting breaks
- Used blue color scheme (bg-blue-500/20, text-blue-400) to differentiate from the emerald business settings section
- `WebsiteCrawlAnalysis` interface defined locally in SettingsTab — mirrors the API response shape
- Checkboxes implemented as toggle buttons with CheckSquare/Square icons (no native checkbox styling needed)

## VoiceTab Component — 2026-03-29

### What Was Built
- New `src/components/tenant/VoiceTab.tsx` — full voice channel management tab
- Added to dashboard as "📞 טלפון" tab in `src/app/tenant/[id]/page.tsx`

### Sections in VoiceTab:
1. **Agent setup** — toggle enable/disable, "הקם סוכן" button (POST /voice/setup)
2. **Phone number** — display Twilio number (manual allocation initially)
3. **Voice selection** — dropdown from `voice_catalog` with audio preview (preview_url)
4. **Greeting** — customizable first message for phone calls
5. **Custom instructions** — voice-specific instructions (separate from WhatsApp agent_prompt)
6. **Call history** — table from `call_logs` (caller, duration, status, summary)

### Integration Points:
- Voice tab only visible when feature is relevant (tab flag: `tab_voice`)
- `activeTab` union type extended: `"chat" | "settings" | "connect" | "contacts" | "capabilities" | "leads" | "calendar" | "voice"`
- Tenant interface extended with: `elevenlabs_agent_id?: string | null`, `voice_enabled?: boolean`
- CapabilitiesTab: visual notice "בסיס הידע משותף לוואטסאפ ולטלפון" when voice is enabled
- KB operations in CapabilitiesTab trigger `/api/tenants/[tenantId]/voice/kb-sync` when voice is enabled

### Patterns:
- Uses same dark theme + emerald accent as other tabs
- React.memo wrapper for performance
- RTL Hebrew layout
- Audio preview: `<audio>` element with play/pause toggle per voice option

## Purchase Flows Admin UI — 2026-03-22

### What Was Built
- **List page**: `src/app/admin/purchase-flows/page.tsx` — shows all tenants with purchase flow status (enabled/disabled, product count, field count)
- **Detail page**: `src/app/admin/purchase-flows/[tenantId]/page.tsx` — full config form: enable toggle, products CRUD, required fields CRUD, checkout URL template, agent instructions
- **Nav link**: Added ShoppingCart icon + "תהליכי רכישה" link to admin sidebar in `src/app/admin/layout.tsx`

### Patterns
- Admin pages use Tailwind classes directly (no CSS Modules) — matching features/customers pages
- Orange color scheme (bg-orange-500/10, text-orange-400, border-orange-500/20) to differentiate from existing sections
- Dynamic list pattern: array state + add/remove/update helpers — each item in a bordered card with trash icon
- `useParams` from next/navigation for client-side route params (avoids async params in client components)
- Default required fields pre-filled (name, phone, email, address) to save admin setup time
- CheckCircle2 toggle button for required/optional field status (same pattern as SettingsTab checkboxes)
- API shape: GET returns `PurchaseFlowData`, PUT accepts partial update body — filters empty items before save