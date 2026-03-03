# UX Skills & Patterns

## UI States — Always Design All Four

Every data-driven UI element must have these states designed:

```
1. Loading — skeleton or spinner while data is fetched
2. Empty  — first-time user, no data yet (with a clear CTA)
3. Error  — something went wrong (with recovery action)
4. Success / Filled — normal state with data
```

**Empty state pattern:**
```
[Icon]
[Friendly headline]
[Explanation sentence]
[Primary CTA button]

Example:
🔌 No WhatsApp connected yet
Connect your WhatsApp number to start receiving messages automatically.
[Connect WhatsApp →]
```

---

## Tab Navigation Pattern (existing dashboard)

The tenant dashboard uses tabs. New features should follow the same tab structure:
- **Connect** — WhatsApp connection status + QR code
- **Settings** — business profile + agent configuration
- **Capabilities** — knowledge base management
- **Chat** — conversation view
- **Contacts** — contact rules (allow/block list)

---

## WhatsApp Chat Bubble Design

```
Incoming (customer):
┌─────────────────────────────┐
│ Message content              │
│                        10:32 │
└─────────────────────────────┘ (left-aligned, white bg)

Outgoing (AI or owner):
                ┌─────────────────────────────┐
                │ Message content              │
                │                   10:33 ✓✓  │
                └─────────────────────────────┘ (right-aligned, light green bg)
```

---

## Agent Mode Status Indicator

```
● Active   — green dot, "AI is responding automatically"
● Learning — yellow dot, "AI is watching but not responding"
● Paused   — gray dot, "AI is disabled"
```

---

## Form Design Guidelines

- Group related fields in a card with a clear heading
- Show validation errors inline (below the field, red text)
- Use placeholder text to show format, not to replace labels
- "Save" button at the bottom, disabled while saving
- Show success feedback inline (not a full-page reload)

```
┌─ Business Profile ──────────────────────────────┐
│ Business Name *                                  │
│ [________________________]                       │
│                                                  │
│ Description                                      │
│ [________________________]                       │
│ [________________________]                       │
│                                                  │
│                              [Cancel]  [Save →]  │
└──────────────────────────────────────────────────┘
```

---

## Responsive Breakpoints

- **Mobile**: 375px — single column, full-width cards
- **Tablet**: 768px — two columns where appropriate
- **Desktop**: 1200px — sidebar + main content

Always design mobile-first. Most business owners will use the dashboard on their phone.

---

## Accessibility Checklist

- Color contrast ratio ≥ 4.5:1 for normal text, 3:1 for large text
- All interactive elements reachable by keyboard (Tab key)
- Focus indicator visible (don't remove outline entirely)
- Error messages linked to their input (`aria-describedby`)
- Loading states announced to screen readers (`aria-live="polite"`)
- Icon-only buttons have `aria-label`
