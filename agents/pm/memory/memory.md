# PM Memory

## Planning Patterns

- **Full-stack features** (UI + API + DB) → involve frontend + backend + ux + security + qa
- **UI-only** → involve frontend + ux + qa
- **API/DB changes** → involve backend + security + qa
- **Deployment/infra** → involve devops (+ backend if code changes needed)
- **Bug fixes** → involve the relevant role + qa
- **Security review** → always involve security when auth, data access, or user input is touched

## Known Project Constraints

- No external UI library — frontend uses CSS Modules only
- Session-manager is a separate service (not Next.js) — changes there need different deploy steps
- Baileys WhatsApp connections are stateful — don't reset sessions carelessly
- Multi-tenant isolation is critical — always ask security to review data access patterns

## User Preferences

- Guy (the developer) prefers concise, actionable output — no fluff
- Code examples are always welcome over just theory
- Prefer TypeScript strict mode
- Hebrew for user-facing copy, English for code and tech decisions
- **Always deploy after every task** — after any fix or change, always: build → commit → push to GitHub (Vercel auto-deploys from push). No exceptions. Never finish a task without deploying.

## Planning Pattern (2026-02-27)
The PM correctly identified the core requirement (chronological sorting) and assigned appropriate agents. However, should have specified that real-time updates via Supabase subscriptions were a critical requirement for the frontend implementation. Also should have emphasized the need for pagination in both backend and frontend to handle large datasets. The synthesis was clear but could have included acceptance criteria for performance and real-time behavior.

## Planning Pattern (2026-02-27)
The plan was well-structured with clear scope (rebranding without code changes) and appropriate agent selection (UX for text/logo, DevOps for domain/docs, QA for testing). However, ensure all agents have access to current environment details (e.g., domain, Vercel project name) upfront to avoid assumptions. Also, coordinate between UX and DevOps on brand color consistency across implementations.

## Planning Pattern (2026-02-27)
The plan correctly identified the two bugs and assigned them to appropriate agents (backend for contact name updates, frontend for real-time refresh). Including QA and Security was excellent for comprehensive coverage. Next time, ensure the synthesis explicitly calls out any dependencies between fixes (e.g., backend contact name updates need to be reflected in frontend real-time subscriptions) and consider adding a 'DevOps' or 'Integration' agent to verify deployment and environment-specific issues.

## Planning Pattern (2026-02-27)
The PM correctly identified this as a data sync issue and provided good context about what was already fixed. However, the PM should have been more specific about which hypothesis to prioritize testing first (race condition vs missing data). For complex sync bugs, consider breaking into smaller investigative tasks: 1) Verify data exists in DB, 2) Test API response, 3) Check frontend state management. Also, ensure all agents have the specific test data (Hebrew message content, contact name) to reproduce the exact bug.

## Planning Pattern (2026-03-01)
The plan correctly identified the core issue and required fixes, but should have specified the exact endpoint (conversations vs. messages) to avoid confusion. The synthesis was clear, but the effort estimation ('M') might be optimistic given the security and real-time complexities. Next time, include explicit acceptance criteria for each fix point (DB query, updated_at maintenance, client-side sorting).

## Planning Pattern (2026-03-02)
The plan correctly identified the core requirement but could have been more specific about the exact WhatsApp Web hierarchy (saved → push → phone, with verified names as special case). Good agent selection covering all aspects. Next time, include explicit acceptance criteria: 'Display must match WhatsApp Web exactly when viewed side-by-side with same WhatsApp account.' Also specify RTL requirements upfront for Hebrew support.

## Planning Pattern (2026-03-05)
For simple CLI verification tasks like this, the PM plan was appropriately minimal (XS effort). However, the PM should ensure agents have clear context about the project stack to avoid making assumptions. For future similar tasks, consider including brief stack context in the plan.

## Planning Pattern (2026-03-14)
The PM plan correctly identified the technical requirements but failed in execution planning: 1) This was primarily a frontend implementation task - backend, security, QA, and DevOps agents were unnecessary for the core implementation and should have been optional reviewers only, 2) The synthesis should have included specific file references and code patterns to follow, 3) Task should have been assigned primarily to frontend with clear success criteria (specific subscriptions to add), 4) PM should monitor agent progress and intervene when agents get stuck in iterations to prevent system errors.