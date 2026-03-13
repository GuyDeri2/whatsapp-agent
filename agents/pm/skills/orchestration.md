# PM Orchestration Skills

## 0. Clarification Protocol

### When to ask
Ask before EVERY non-trivial task unless the request is unambiguous.

### What to ask
Group questions by category:
- **Scope**: What exactly should change? What should NOT change?
- **User impact**: Who sees this? All tenants or specific ones?
- **Design**: Specific UX requirements, or design freely?
- **Constraints**: Performance targets, backward compatibility, deadlines?
- **Integration**: Does this touch external services (WhatsApp, AI, payments)?

### Format (single message, not back-and-forth)
```
Before I plan this out, a few quick questions:

**Scope**
1. Should this affect all tenants or just new ones?

**UX**
2. Do you have a mockup, or should we design the flow?

**Constraints**
3. Any performance requirements or edge cases to be careful about?
```

### Do NOT ask about:
- Things already answered in the request
- Implementation details (those are the agents' job)
- Things you can infer from context/memory

---

## Skill 1 — Task Decomposition
Break any command into role-specific, atomic tasks.

**Pattern:**
```
Command: "Add rate limiting to API routes"

Tasks:
- backend: Implement rate limiting middleware (upstash/ratelimit or custom)
- security: Review attack surface — which routes are highest risk?
- qa: Test scenarios — burst, sustained, per-IP, per-tenant
```

**Rules:**
- One concern per task (don't mix DB + UI in one task)
- Each task must be completable without blocking on other tasks (unless sequential group)
- Include file paths and context in each task

---

## Skill 2 — Agent Selection Matrix

| Need | Agent |
|------|-------|
| UI component / page | frontend |
| API route / database / Baileys | backend |
| User flow / layout / copy | ux |
| RLS / auth / isolation | security |
| Deploy / Docker / CI | devops |
| Tests / edge cases / regression | qa |

**Don't over-involve agents.** A single-file backend fix doesn't need UX or DevOps.

---

## Skill 3 — Parallel vs Sequential

**Parallel** (independent tasks — run together):
- frontend + backend when frontend mocks data while backend implements API
- ux + security when UX designs and security reviews the same feature
- Multiple unrelated components

**Sequential** (group N feeds group N+1):
- Group 1: backend (define API shape) → Group 2: frontend (build UI using that API)
- Group 1: ux (design spec) → Group 2: frontend (implement design)
- Group 1: security (identify risks) → Group 2: backend (implement mitigations)

```json
"sequential_groups": [
  ["t1", "t2"],   // Run t1 and t2 in parallel
  ["t3"]          // After group 1 finishes, run t3
]
```

---

## Skill 4 — Context Provision
Each task instruction must include:
1. **What to do** — specific, actionable
2. **Where** — exact file paths when known
3. **Constraints** — tech stack rules, existing patterns
4. **Output expected** — code, plan, test cases, etc.

**Good task instruction:**
```
Implement rate limiting on POST /api/messages.
Use the Upstash Ratelimit SDK (UPSTASH_REDIS_URL env var available).
Allow 10 requests per minute per tenant_id.
File: src/app/api/messages/route.ts
Return 429 with { error: "Rate limit exceeded" } when triggered.
```

**Bad task instruction:**
```
Add rate limiting
```

---

## Skill 5 — Effort Estimation

| Size | Description | Examples |
|------|-------------|---------|
| XS | < 30 min, 1-2 files | Fix a typo, add a field to a form |
| S | ~1h, 2-4 files | Add a new API route, create a simple component |
| M | ~half day, 4-8 files | New feature with API + UI + tests |
| L | ~1-2 days, 8+ files | Multi-component feature with DB schema changes |
| XL | > 2 days | Major refactor, new service, architectural change |

---

## Skill 6 — Memory Management

**After every task, update memory with:**
```markdown
## [Date] — [Task summary]
**Agents involved**: frontend, backend
**What worked**: Starting with backend API shape before frontend prevented rework
**Mistake**: Forgot to check RLS — security found a tenant isolation bug
**User feedback**: Approved
**Lesson**: Always involve security when adding new DB queries
```

**Before every task, read:**
- `shared/memory/memory.md` — project-wide lessons
- `pm/memory/memory.md` — PM-specific planning lessons
