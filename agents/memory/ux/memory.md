# UX Memory

## Established Design Language

- Primary action color: WhatsApp green `#25D366`
- Dark theme: `#111b21` (main BG), `#202c33` (secondary BG), `#2a3942` (hover)
- Text: white for primary, `#8696a0` for secondary/dim
- Dashboard is tab-based — tabs at top, content below
- Hebrew text everywhere user-facing

## User Mental Model

- Users think in terms of "conversations" not "sessions" or "connections"
- "AI agent" should be called "הבוט" (the bot) or "העוזר האוטומטי"
- Mode switching should feel like a physical toggle — clear on/off states
- Connection status (QR/connected/disconnected) is the most anxiety-inducing UX moment

## Known UX Issues to Avoid

- Don't show raw phone numbers — show contact names where available
- Loading states must be shown immediately — don't let users wonder if something happened
- Confirmation dialogs for destructive actions (disconnect WhatsApp, delete rules)
- Empty knowledge base is a common new-user state — provide helpful empty state with "Add your first FAQ" CTA

## Accessibility

- All interactive elements need keyboard focus styles (green outline `#25D366`)
- Color contrast: ensure text is readable on dark background
- Don't rely on color alone to convey status — use icons + color
- Minimum touch target: 44x44px for mobile

## Positive Pattern (2026-02-27)
[Score: 9/10] When analyzing WhatsApp-like patterns, always include specific visual examples of how sorting changes should appear to users, not just technical specifications.