# Leads Tab — UX Spec (Hebrew RTL)

**Component:** `LeadsTab.tsx`
**Audience:** Israeli small business owner (restaurant, clinic, shop) — not a developer
**Language:** Hebrew (RTL throughout)
**Tone:** Friendly, practical, confidence-building — not technical
**Date:** 2026-03-13

---

## Overview

The Leads tab shows every potential customer who was "handed off" to the business owner during a WhatsApp conversation. The AI detected that the person wanted more personal attention, collected their details, and saved them as a lead. The owner can view leads, export them, and optionally wire them up to Make.com / Zapier so they flow automatically into Monday.com, Google Sheets, or a CRM.

---

## 1. Header Section

**Location:** Top of tab, full width card
**Visual treatment:** Same dark glass card pattern as ContactsTab header — `bg-white/[0.02] border border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-xl` — with a gradient top stripe in amber/orange tones (to distinguish from other tabs).
**Icon:** `UserCheck` (lucide) — amber-400 tint inside a `rounded-xl bg-amber-500/20 ring-1 ring-amber-500/30` badge, 48×48px.

### Copy

**Title (h2):**
```
לידים
```

**Subtitle (p, neutral-400, leading-relaxed):**
```
כאן מופיעים כל הלקוחות הפוטנציאליים שהבוט זיהה שצריכים טיפול אישי.
הבוט אסף את פרטיהם, סיכם את השיחה — ועכשיו הם כאן, מחכים לך.
```

**Inline tip badge (below subtitle, amber tint):**
Icon: `Zap` (w-3.5 h-3.5)
```
חבר ל-Make.com כדי שכל ליד חדש יגיע ישירות ל-Monday / Google Sheets / CRM שלך.
```

---

## 2. Webhook Configuration Card

**Visual treatment:** Same pattern as CapabilitiesTab webhook section — `bg-white/[0.02] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-xl relative overflow-hidden` — with a violet ambient glow `bg-violet-500/10 rounded-full blur-[80px]` in the top-left corner.
**Icon:** `Webhook` (lucide) — violet-400 tint, inside `w-10 h-10 rounded-xl bg-violet-500/20 ring-1 ring-violet-500/30`.

### Card Title
```
חיבור אוטומטי ל-Make / Zapier
```

### Card Subtitle (neutral-400, text-sm)
```
כשנוצר ליד חדש, הוא יישלח אוטומטית לכל מקום שתבחר — Monday, Google Sheets, אימייל ועוד.
```

---

### Step-by-Step Mini-Guide

**Label above steps (text-sm font-semibold text-neutral-300):**
```
איך מגדירים? פשוט מאוד:
```

**Steps list — numbered, `space-y-2`, each step in a small pill-row:**

| # | Hebrew copy |
|---|-------------|
| 1 | פתח את **Make.com** (או Zapier) בלשונית חדשה |
| 2 | צור **Scenario** חדש ← בחר טריגר **"Custom webhook"** |
| 3 | Make יתן לך **כתובת URL** — העתק אותה |
| 4 | הדבק את הכתובת בשדה למטה |
| 5 | לחץ **שמור** — מעכשיו כל ליד חדש יישלח אוטומטית |

**Visual treatment for steps:** Each step is a flex row — small circle badge with step number (amber-400, bg-amber-500/15, w-6 h-6 text-xs font-bold) + text (text-sm text-neutral-300). Bold words (Make.com, Scenario, URL, שמור) use `font-semibold text-white`.

**Helper link (text-xs text-violet-400 underline, after step list):**
```
לא יודע איך? צפה בסרטון הדרכה קצר →
```
_(Note to developer: link TBD — can be a YouTube tutorial link or docs page)_

---

### Data Preview Block

**Label (text-xs font-semibold text-neutral-300 mb-2):**
```
המידע שיישלח בכל ליד:
```

**Four field chips in a 2×2 or 4-column grid** (same style as CapabilitiesTab — `bg-white/5 rounded-xl px-3 py-2 border border-white/5`):

| Field (font-mono violet-400) | Label (text-neutral-500 text-[11px]) |
|---|---|
| `👤 name` | שם הלקוח |
| `📞 phone` | מספר טלפון |
| `📧 email` | מייל (אם נאסף) |
| `📋 summary` | סיכום השיחה |

---

### URL Input + Save Button

**Input label (text-xs font-medium text-neutral-400, above field):**
```
כתובת ה-Webhook
```

**Input placeholder (dir="ltr"):**
```
https://hook.eu1.make.com/...
```

**Input styling:** `flex-1 bg-black/40 border border-white/10 rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-white text-sm transition-all placeholder:text-neutral-600`

**Save button — idle state:**
- Icon: `Save` w-4 h-4
- Label: `שמור`
- Style: `bg-violet-600 hover:bg-violet-500 text-white px-5 py-2.5 rounded-xl font-medium text-sm`

**Save button — saving state (disabled):**
- Icon: spinner / `Loader2` w-4 h-4 animate-spin
- Label: `שומר...`
- Style: muted violet, disabled

**Save button — success state (3 sec, then reverts):**
- Icon: `CheckCircle2` w-4 h-4
- Label: `נשמר!`
- Style: `bg-emerald-600/20 text-emerald-400 border border-emerald-500/30`

**Validation — empty URL, on save attempt:**
Inline error below input (text-xs text-red-400):
```
אנא הדבק כתובת webhook תקינה
```

**Validation — invalid URL format:**
```
הכתובת לא נראית תקינה — וודא שהיא מתחילה ב-https://
```

**Inline success message (below input, fade in/out, text-xs text-emerald-400):**
```
✓ הכתובת נשמרה. מעכשיו לידים חדשים יישלחו אוטומטית.
```

---

## 3. Leads Table

**Card visual treatment:** `bg-white/[0.02] border border-white/10 rounded-2xl p-6 backdrop-blur-xl`

**Card header row (flex justify-between items-center mb-5):**

Left side — title:
```
הלידים שלך
```
(text-lg font-semibold text-white, with `UserCheck` icon amber-400)

Right side — count badge:
```
סה״כ: {count}
```
(text-xs bg-white/5 rounded-full border border-white/10 text-neutral-400 py-1 px-2.5)

**Export button (top-right of card header, alongside count badge):**
- Icon: `Download` w-4 h-4
- Label: `ייצא הכל ל-CSV`
- Style: `text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-3 py-1.5 text-neutral-300 transition-all flex items-center gap-1.5`
- Tooltip / description text (text-xs text-neutral-500, below button or as title attr):
  ```
  מוריד קובץ Excel/CSV עם כל הלידים לפתיחה ב-Google Sheets
  ```

**"Resend all to webhook" button (below export, or grouped):**
- Icon: `Send` w-4 h-4 violet-400
- Label: `שלח הכל מחדש ל-Webhook`
- Style: same muted style, violet tint
- Description (text-xs text-neutral-500, below or tooltip):
  ```
  שולח מחדש את כל הלידים לכתובת ה-Webhook שהגדרת — שימושי אם חיברת את Make לאחר שנצברו לידים
  ```
- Disabled state (no webhook URL configured) — grayed out with tooltip:
  ```
  הגדר כתובת Webhook קודם
  ```

---

### Empty State (No Leads Yet)

**Visual:** Same dashed border empty state as ContactsTab — `min-h-[300px] flex flex-col items-center justify-center border-2 border-dashed border-white/5 rounded-xl bg-black/20 p-8 text-center`

**Icon container:** `bg-white/5 p-4 rounded-full mb-4`
**Icon:** `Inbox` (lucide) w-8 h-8 opacity-50

**Primary message (text-lg font-medium text-neutral-400 mb-1):**
```
עדיין אין לידים
```

**Secondary message (text-sm text-neutral-500 max-w-xs):**
```
כשלקוח יבקש לדבר עם נציג, הבוט יאסוף את פרטיו וימלא את הרשימה הזו.
```

**Encouraging call-to-action (text-xs text-violet-400 mt-3):**
```
רוצה לראות איך זה עובד? שלח הודעה לבוט ובקש "לדבר עם נציג"
```

---

### Table with Leads

**Layout:** Responsive table — on mobile collapses to card-per-row; on desktop full table.

**Column headers (text-xs text-neutral-500 uppercase tracking-wider, border-b border-white/5):**

| Column | Header text | Notes |
|--------|------------|-------|
| שם | שם הלקוח | |
| טלפון | טלפון | dir="ltr", formatted as `05x-xxx-xxxx` |
| מייל | מייל | `—` if empty |
| סיכום שיחה | סיכום | Truncated to ~60 chars with expand button |
| תאריך | תאריך | Relative (e.g. "לפני 3 שעות") + full date on hover |
| פעולות | — | Delete icon only |

**Row styling:** `hover:bg-white/5 transition-colors border-b border-white/5 last:border-0`

**Summary cell expand pattern:**
If summary > 60 chars, show truncated + a `...קרא עוד` link (text-xs text-violet-400) that expands inline or opens a small modal/popover.

**Email cell — empty state:**
Show `—` in text-neutral-600. Tooltip: `לא נאסף מייל בשיחה זו`

**Phone cell:**
Display formatted (same `formatPhone` util as ContactsTab). `dir="ltr"`.

**Date cell:**
- Primary: relative time (`לפני שעתיים`, `אתמול`, `לפני 3 ימים`)
- `title` attribute: full ISO date (shows on hover)

---

### Delete Lead — Confirmation

**Trigger:** Clicking the `Trash2` icon on a row. Icon is hidden until row hover (same pattern as ContactsTab: `opacity-0 group-hover:opacity-100`).

**Inline confirmation pattern** (no modal — replace the trash icon with two small buttons inline in the row for 3 seconds):

Replace trash icon with:
```
מחק?  [כן]  [לא]
```
- "מחק?" — text-xs text-neutral-400
- "[כן]" — text-xs text-red-400 hover:text-red-300 font-semibold
- "[לא]" — text-xs text-neutral-500 hover:text-neutral-300

**Auto-cancel:** If no action within 4 seconds, revert to trash icon.

**After delete — row removal animation:** `animate-out fade-out slide-out-to-right duration-300`

**Toast notification (bottom of screen, 3 sec):**
```
הליד נמחק
```
With undo link: `[בטל]` (text-violet-400) — if clicked within 3 sec, restores via optimistic update.

---

## 4. How It Works — Explanation Box

**Placement:** Bottom of the tab, below the leads table.
**Style:** Collapsible section — starts **collapsed** by default (users don't need to read it every time). Toggle via a slim bar.

**Collapsed state bar:**
`bg-white/[0.015] border border-white/5 rounded-2xl px-5 py-3 flex justify-between items-center cursor-pointer hover:bg-white/[0.04] transition-all`

**Bar label:**
```
איך הכל עובד? ←
```
(text-sm font-medium text-neutral-400, with `ChevronDown` icon that rotates 180° when open)

---

### Expanded Content

**Visual:** Same glass card, `p-6 space-y-5 animate-in fade-in duration-300`

**Title (text-base font-semibold text-white mb-4):**
```
המסע של ליד — משלב הצ'אט ועד ה-CRM שלך
```

**Flow diagram — text-based, horizontal steps (flex row with arrows, wraps on mobile):**

```
לקוח שולח הודעה ב-WhatsApp
         ↓
   הבוט מזהה שהלקוח צריך עזרה אישית
         ↓
   הבוט מבקש שם, טלפון ומייל
         ↓
   ליד נשמר כאן (בטאב הזה)
         ↓
   Webhook שולח את הפרטים ל-Make.com
         ↓
   Make שולח ל-Monday / Sheets / CRM שלך
         ↓
   אתה מקבל עדכון ומטפל בלקוח
```

**Implementation note:** Render as a vertical stepper on mobile, horizontal flow on desktop (`flex-col md:flex-row`). Each step is a small pill: `bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-sm text-neutral-300`, connected by `→` arrows in text-neutral-600.

---

**"What data is sent?" sub-section:**

**Label (text-sm font-semibold text-neutral-300 mb-3):**
```
מה בדיוק נשלח ל-Make?
```

**4-column chip grid (same as webhook data preview above):**

| Field | Hebrew label | Extra note |
|-------|-------------|-----------|
| `name` | שם הלקוח | כפי שנמסר בשיחה |
| `phone` | מספר טלפון | פורמט בינלאומי, למשל 972501234567 |
| `email` | כתובת מייל | ריק אם לא נמסר |
| `summary` | סיכום השיחה | נוצר אוטומטית על ידי הבוט |
| `timestamp` | תאריך ושעה | ISO 8601, UTC |
| `tenant_id` | מזהה העסק | לשימוש ב-Make לזיהוי מקור |

**Note:** The expanded chip grid here is 3-column (6 fields).

---

**"Common uses" sub-section (optional, collapsed within the expanded box):**

**Label:**
```
מה עושים עם זה ב-Make?
```

**Bullet list (text-sm text-neutral-400 space-y-2):**
- ➕ מוסיפים שורה ב-**Google Sheets** עם פרטי הליד
- 📋 יוצרים **Task חדש ב-Monday** עם שם הלקוח ותיאור הבעיה
- 📧 שולחים **אימייל אוטומטי** ללקוח: "קיבלנו את פנייתך, ניצור קשר בקרוב"
- 📲 שולחים **הודעת WhatsApp** לעצמך עם סיכום הליד
- 🗂 מוסיפים ל-**HubSpot / Pipedrive / Zoho CRM**

---

## 5. Component States Summary

| State | What to show |
|-------|-------------|
| Loading leads | Skeleton rows (3 rows, animated pulse) in table area |
| No webhook configured + leads exist | Soft banner above table: "חבר Webhook כדי שלידים יגיעו ישירות ל-CRM שלך" with CTA button scrolling up to webhook card |
| Webhook configured + 0 leads | Empty state as above, but add note: "Webhook מוגדר — הלידים יישלחו אוטומטית כשיגיעו" |
| Webhook save error (network) | Error below input: "לא הצלחנו לשמור. בדוק את החיבור ונסה שוב." |
| Delete in progress | Row dims to opacity-50, trash icon replaced by spinner |

---

## 6. Color Accent Palette for This Tab

| Element | Color |
|---------|-------|
| Tab accent / header stripe | amber-500 / amber-400 |
| Webhook card accent | violet-500 / violet-400 (consistent with CapabilitiesTab) |
| Lead row hover | white/5 |
| Delete action | red-400 |
| Success states | emerald-400 |
| CTA links | violet-400 |

The amber accent differentiates Leads from the emerald (Contacts) and violet (Capabilities) tabs, while violet is reused for the webhook sub-component to maintain consistency with the existing webhook pattern.

---

## 7. Accessibility & RTL Notes

- All Hebrew text: `dir="rtl"` (default via global CSS — no need to set per element)
- Phone numbers, URLs, email addresses: `dir="ltr"` on those specific elements
- Table on mobile: collapse to card list (`flex flex-col gap-3`), each card shows all fields vertically
- Keyboard: delete confirmation buttons must be focusable; auto-cancel on blur after 4 sec
- Tooltip on truncated summary: use `title` attribute or a small popover, not a full modal
- Export CSV: should include BOM (`\uFEFF`) for correct Hebrew rendering in Excel

---

## 8. Hebrew Copy Glossary (for developer reference)

| Key | Hebrew |
|-----|--------|
| Tab name | לידים |
| Lead (noun) | ליד |
| Leads (plural) | לידים |
| Webhook URL input label | כתובת ה-Webhook |
| Save button | שמור |
| Saved button (success) | נשמר! |
| Export CSV | ייצא הכל ל-CSV |
| Resend to webhook | שלח הכל מחדש ל-Webhook |
| Delete lead | מחק ליד |
| Delete confirmation | מחק? |
| Confirm yes | כן |
| Confirm no | לא |
| Empty state title | עדיין אין לידים |
| Loading | טוען... |
| How it works toggle | איך הכל עובד? |
| Name column | שם הלקוח |
| Phone column | טלפון |
| Email column | מייל |
| Summary column | סיכום |
| Date column | תאריך |
| Actions column | פעולות |
| No email collected | לא נאסף מייל |
| Lead deleted toast | הליד נמחק |
| Undo | בטל |
