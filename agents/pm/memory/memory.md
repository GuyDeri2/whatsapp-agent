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
- **NEVER ask Guy to run anything manually** — deploys, migrations, CLI commands — agents must do everything themselves. DevOps agent has full access to Supabase CLI, Vercel CLI, and Render MCP tools.

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

## Planning Pattern (2026-03-15)
The PM plan was well-structured with clear separation of database and DevOps tasks. Both agents were correctly selected for their respective domains. The synthesis effort 'M' was appropriate - this was a straightforward task that didn't require complex coordination. For future similar tasks, the PM should remember to explicitly ask agents to include security considerations and verification steps in their outputs, and to ensure both agents coordinate on any dependencies (though none were needed here).

## Planning Pattern (2026-03-15)
The PM plan was clear in describing the bug and target (session-manager contact_name fix), but agent selection was inefficient. Security agent was unnecessary for this functional bug fix. The synthesis effort 'S' might indicate minimal planning, leading to agents getting stuck in tool iterations without proper guidance. Next time, PM should: 1) Only assign backend (for code fix) and QA (for verification), skipping security unless security implications are identified; 2) Provide more specific guidance on code location (session-manager's outgoing message handler) to prevent agents from looping; 3) Consider breaking the task into smaller steps if tool iterations are an issue.

## Major Implementation — 2026-03-17: Anti-Ban + LID Fix + Encrypted Backup
Three major features were implemented together because they're deeply interconnected:

### 1. LID Conversation Splitting (Root Cause Fix)
- **Problem**: Same contact created 2 conversations — one with real phone, one with LID number
- **Root cause**: `clearAuthState()` deleted `lid_*` mapping rows from whatsapp_sessions on every reconnect
- **Fix**: 3 layers — preserve mappings in clearAuthState, deferred fix (3s), periodic sweep (60s)
- **Files**: session-manager.ts, session-store.ts

### 2. Encrypted Creds Backup (Auto-Reconnect After Deploy)
- **Problem**: Every deploy disconnected WhatsApp — no way to reconnect without QR rescan
- **Root cause**: No creds survived `clearAuthState` → `restoreAllSessions` had nothing to restore
- **Fix**: Separate `whatsapp_creds_backup` table with AES-256-GCM encryption, auto-restore on startup
- **Files**: session-store.ts, session-manager.ts, migration SQL

### 3. Anti-Ban Protection
- **Problem**: Bot behavior detectable by Meta — always online, instant replies, no read receipts
- **Research**: Comprehensive web research on WhatsApp ban detection, baileys-antiban lib (broken), community best practices
- **Fix**: New `antiban.ts` module with health monitoring, gaussian jitter, presence pause, read receipts
- **Key decision**: `baileys-antiban` npm package was broken (no dist/) — all features built from scratch
- **Files**: antiban.ts (new), session-manager.ts, message-handler.ts, server.ts

### 4. Code Review Cleanup
- Removed all `as any` casts, named magic constants, fixed comments, optimized SQL queries
- Deleted legacy `webhook/route.ts` (CRITICAL tenant isolation breach)

### Lesson: Interconnected fixes
These 3 features couldn't be done independently — the LID fix required preserving session rows, which required understanding clearAuthState, which led to discovering the creds backup need, which required the encrypted backup table. The anti-ban work built on top of the same session infrastructure. Always consider cross-cutting concerns when planning.

## Production Launch Audit — 2026-03-17
Before going to market, a full security audit + anti-ban risk assessment was performed:
- Security: found 7.5/10 risk score — 3 P0, 4 P1, 5 P2 issues. ALL fixed in commit `f83394a`.
- Anti-ban: found 5/10 risk score (7/10 multi-tenant). Top 3 risks fixed: identical browser fingerprint, instant read receipts, no global rate limit.
- Key lesson: security audit should be done BEFORE any market launch, not after. Make this a standard step in any "launch" plan.
- User decision: speed > safety. Bot must answer FAST. No proportional typing duration for long messages. Typing cap stays at 3 seconds.
- User decision: presence pause is OK because messages still process while showing "unavailable".

## Planning Pattern (2026-03-15)
The PM plan was well-structured with clear investigation steps, but agent selection was suboptimal. Security was unnecessary for this technical debugging task. The synthesis effort was appropriate, but the PM should monitor agent progress and intervene when multiple agents timeout. Next time: 1) Assign only relevant roles (backend, devops, maybe QA), 2) Set clearer success criteria for each agent, 3) Implement progress checks to prevent timeout loops, 4) Consider having agents collaborate rather than work in isolation.

## Planning Pattern (2026-03-17)
The plan correctly identified the investigation areas (session-manager auth flow, DB credential checks, logs) but the agent selection and task assignment could be improved. Backend, DevOps, and Database agents all failed due to iteration limits - suggesting the tasks were too broad or not properly scoped. PM should: 1) Break investigation into smaller, focused tasks (e.g., 'Check session-manager.ts startSession method only' rather than 'Check all auth flow'), 2) Provide more specific guidance on what to look for (e.g., 'Look for registered flag not being cleared in clearAuthState'), 3) Consider having one agent do initial investigation then delegate specific follow-ups. The synthesis was clear but didn't anticipate the iteration limit issue that caused multiple failures.

## Planning Pattern (2026-03-17)
The PM plan was well-structured and correctly interpreted the original command. However, for tasks involving version checks and known issues, consider specifying whether the analysis should include only current issues or also historical fixes that have been resolved. This would help agents prioritize their investigation and reporting.

## Planning Pattern (2026-03-17)
The task breakdown was well-structured but should have explicitly distinguished between the two OAuth flows (user authentication via Supabase vs. calendar integration via custom API). All agents were correctly selected, but the synthesis could have been more specific about which flow was failing (likely the Supabase authentication OAuth based on the original command mentioning login/register pages).
## Agent System Cleanup — 2026-03-22
- Deleted ~40 deprecated files from agents/ (run.ts, base-agent.ts, pm-agent.ts, reviewer.ts, types.ts, memory-manager.ts, team/*.ts, workflows/, memory/, logs/, node_modules/)
- All agents now work exclusively through Claude Code Agent tool — no external DeepSeek API calls
- PM auto-delegation rule added to CLAUDE.md: all dev tasks route through PM + subagents
- Hebrew communication rule added to all agent command files

## Communication Rule — 2026-03-22
All agents must communicate with the user (Guy) in Hebrew. Code, variable names, and technical terms stay in English. This was added to all `.claude/commands/agent-*.md` files and `team.md`.
