# Agents — AI Dev Team (Powered by Claude Code)

This folder contains the **knowledge base** for the AI dev team. The agents run through **Claude Code** (not DeepSeek).

## How It Works Now

Agents are invoked via Claude Code custom commands (slash commands):

```
/project:team "Add a search bar to the contacts page"     ← Full team orchestration
/project:agent-frontend "Fix the loading state in ChatTab" ← Single agent
/project:agent-backend "Add rate limiting to API routes"    ← Single agent
/project:agent-feedback frontend 9 "Great component!"       ← Record feedback
```

### Available Commands

| Command | What it does |
|---------|-------------|
| `/project:team <task>` | PM orchestrates the full team — plans, dispatches subagents, synthesizes |
| `/project:agent-frontend <task>` | Frontend specialist (React, Next.js, CSS Modules) |
| `/project:agent-backend <task>` | Backend specialist (API routes, Supabase, session-manager) |
| `/project:agent-ux <task>` | UX designer (flows, copy, layout, accessibility) |
| `/project:agent-security <task>` | Security engineer (auth, RLS, multi-tenant isolation) |
| `/project:agent-devops <task>` | DevOps engineer (deploy, infrastructure, CI/CD) |
| `/project:agent-qa <task>` | QA engineer (tests, edge cases, acceptance criteria) |
| `/project:agent-database <task>` | Database architect (schema, migrations, RLS, indexes) |
| `/project:agent-feedback <role> <score> "<comment>"` | Record feedback for an agent |

## Architecture

Each agent has its own directory with knowledge files:
- **README.md** — role definition, responsibilities, skills, critical rules
- **skills/** — detailed techniques, code patterns, templates
- **memory/** — personal learned patterns (grows over time)

```
agents/
├── pm/                 ← Project Manager knowledge
│   ├── README.md
│   ├── skills/orchestration.md
│   └── memory/memory.md
├── frontend/           ← Frontend Developer knowledge
│   ├── README.md
│   ├── skills/skills.md
│   └── memory/memory.md
├── backend/            ← Backend Developer knowledge
│   ├── README.md
│   ├── skills/skills.md
│   └── memory/memory.md
├── ux/                 ← UX Designer knowledge
│   ├── README.md
│   ├── skills/skills.md
│   └── memory/memory.md
├── security/           ← Security Engineer knowledge
│   ├── README.md
│   ├── skills/skills.md
│   └── memory/memory.md
├── devops/             ← DevOps Engineer knowledge
│   ├── README.md
│   ├── skills/skills.md
│   └── memory/memory.md
├── qa/                 ← QA Engineer knowledge
│   ├── README.md
│   ├── skills/skills.md
│   └── memory/memory.md
├── database/           ← Database Architect knowledge
│   ├── README.md
│   ├── skills/skills.md
│   └── memory/memory.md
└── shared/             ← Shared context (loaded by ALL agents)
    └── memory/memory.md
```

## Flow

```
User invokes /project:team "task"
     ↓
Claude Code reads PM knowledge + shared memory
     ↓
Claude Code (as PM) creates a plan, presents to user
     ↓
Subagents launched via Agent tool (parallel when possible)
  Each subagent reads: README.md + skills + memory for its role
  Each subagent ACTUALLY IMPLEMENTS changes (edits files, writes code, runs commands)
     ↓
Claude Code synthesizes results, verifies build
     ↓
Memory files updated with lessons learned
```

## Editing Agent Behaviour

To change how an agent thinks or what it knows:
- **Edit `<role>/README.md`** — source of truth for the agent's persona
- **Add to `skills/`** — reference docs, patterns, code examples
- **Edit `memory/memory.md`** — manual lessons or corrections
- **Use `/project:agent-feedback`** — structured feedback that updates memory

## Adding a New Agent

1. Create `<role>/README.md` with role definition
2. Create `<role>/skills/skills.md` with key patterns
3. Create `<role>/memory/memory.md` (empty or initial content)
4. Create `.claude/commands/agent-<role>.md` with the command template
5. Add the role to the `/project:team` command's agent table
6. Add delegation rules to `agents/pm/README.md`
