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

## Planning Pattern (2026-02-27)
The PM correctly identified the core requirement (chronological sorting) and assigned appropriate agents. However, should have specified that real-time updates via Supabase subscriptions were a critical requirement for the frontend implementation. Also should have emphasized the need for pagination in both backend and frontend to handle large datasets. The synthesis was clear but could have included acceptance criteria for performance and real-time behavior.