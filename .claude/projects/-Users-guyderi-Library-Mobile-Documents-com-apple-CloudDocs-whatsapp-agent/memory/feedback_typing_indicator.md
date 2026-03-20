---
name: Short typing indicators
description: Keep typing indicator duration short — don't simulate long typing times
type: feedback
---

Keep typing indicator (composing) duration short — max ~1.5 seconds, not proportional to message length.

**Why:** User finds long typing indicators annoying/unnatural. The anti-ban benefit of long typing is minimal compared to other measures.

**How to apply:** In the Baileys human-like send wrapper, cap typing simulation at 1-1.5 seconds with small jitter, regardless of message length.
