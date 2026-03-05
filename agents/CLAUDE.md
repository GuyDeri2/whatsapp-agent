# Agents — AI Dev Team

This folder contains an AI-powered development team for the WhatsApp Agent project.

## Architecture

Each agent has its own directory with:
- **README.md** — role definition, responsibilities, skills, critical rules
- **skills/** — detailed techniques, code patterns, templates
- **memory/** — personal learned patterns (auto-updated by reviewer after each run)

```
agents/
├── run.ts              ← CLI entry: npx tsx run.ts "<task>"
├── types.ts            ← All TypeScript interfaces
├── memory-manager.ts   ← File-based memory R/W
├── base-agent.ts       ← Abstract base class (loads README.md automatically)
├── pm-agent.ts         ← PM: plans, dispatches, synthesizes
├── reviewer.ts         ← Post-task feedback loop + memory updates
│
├── pm/                 ← Project Manager (Orchestrator)
│   ├── README.md       ← PM role definition & workflow
│   ├── skills/
│   │   └── orchestration.md
│   └── memory/
│       └── memory.md
│
├── frontend/           ← React/Next.js specialist
│   ├── README.md
│   ├── skills/skills.md
│   └── memory/memory.md
│
├── backend/            ← API/DB/session-manager specialist
│   ├── README.md
│   ├── skills/skills.md
│   └── memory/memory.md
│
├── ux/                 ← UX design specialist
│   ├── README.md
│   ├── skills/skills.md
│   └── memory/memory.md
│
├── security/           ← Security review specialist
│   ├── README.md
│   ├── skills/skills.md
│   └── memory/memory.md
│
├── devops/             ← Infrastructure specialist
│   ├── README.md
│   ├── skills/skills.md
│   └── memory/memory.md
│
├── qa/                 ← Testing specialist
│   ├── README.md
│   ├── skills/skills.md
│   └── memory/memory.md
│
├── shared/             ← Shared context (loaded by ALL agents)
│   ├── memory/
│   │   └── memory.md  ← Shared lessons and project context
│   └── knowledge/
│       └── project-context.md  ← Project overview (reference copy)
│
└── team/               ← TypeScript agent classes (thin wrappers)
    ├── frontend.ts     ← Just declares role + roleLabel
    ├── backend.ts
    ├── ux.ts
    ├── security.ts
    ├── devops.ts
    └── qa.ts
```

## How It Works

1. **Role definitions live in markdown** — each agent's persona, skills, and rules are in `<role>/README.md`
2. **`base-agent.ts` loads README.md at runtime** — no hardcoded prompts in TypeScript
3. **Memory is co-located with each agent** — `<role>/memory/memory.md` grows automatically after each run
4. **`team/*.ts` files are thin** — just `role` and `roleLabel`, everything else from markdown

## Flow

```
User command
     ↓
PM reads pm/README.md + pm/memory/memory.md + shared/memory/memory.md
     ↓
PM creates JSON plan
     ↓
Agents run (each loads their README.md + memory automatically)
     ↓
PM synthesizes all outputs
     ↓
Reviewer LLM evaluates + updates <role>/memory/memory.md
     ↓
Run log saved to logs/<runId>.json
```

## Editing Agent Behaviour

To change how an agent thinks or what it knows:
- **Edit the agent's `README.md`** — this is the source of truth for the agent's persona
- **Add to `skills/`** — add reference docs, patterns, code examples
- **Edit `memory/memory.md`** — add manual lessons or corrections

No TypeScript changes needed for prompt/persona adjustments.

## Adding a New Agent

1. Create `<role>/README.md` with role definition
2. Create `<role>/skills/skills.md` with key patterns
3. Create `<role>/memory/memory.md` (empty or initial content)
4. Add the role to `AgentRole` type in `types.ts`
5. Create `team/<role>.ts` (just role + roleLabel, extends BaseAgent)
6. Register the agent in `PMAgent.team` map in `pm-agent.ts`

## CLI Usage

```bash
# Run a development task
npx tsx agents/run.ts "Add a search bar to the contacts page"
npx tsx agents/run.ts "Add rate limiting to API routes"

# Give explicit feedback for learning
npx tsx agents/run.ts feedback <role> <score 1-10> "<comment>"
npx tsx agents/run.ts feedback security 7 "Good analysis but missed rate limiting"
```

## Dependencies

- `openai` — DeepSeek API (OpenAI-compatible)
- `dotenv` — loads `.env.local` from parent directory
- `tsx` — TypeScript execution (dev only)

Install: `npm install` from within this `agents/` folder.

## Execution Capabilities (CLI Access)
Unlike basic LLM templates, every agent in this framework has access (via their `base-agent.ts` executor loop) to an `execute_cli_command` tool.
- Agents CAN and SHOULD use this to run tests, build the project (`npm run build`), push to Supabase (`npx supabase db push`), or deploy to services like Vercel or Render.
- They will automatically receive the STDOUT/STDERR back in their prompt context.
