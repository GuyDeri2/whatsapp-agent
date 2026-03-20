# Agent Feedback & Learning

Record feedback for a specific agent to improve future performance.

**Feedback:** $ARGUMENTS

## Instructions

Parse the feedback from the user. Expected format: `<role> <score 1-10> "<comment>"`
Example: `frontend 9 "Clean component structure, good TypeScript"`

## Process

1. **Identify the agent** — which role is getting feedback (frontend, backend, ux, security, devops, qa, database, pm)
2. **Read their memory** — read `agents/<role>/memory/memory.md`
3. **Extract the lesson** — from the score and comment, determine:
   - If score >= 7: This is a **Positive Pattern** to reinforce
   - If score < 7: This is an **Improvement Note** to correct behavior
4. **Update memory** — append to `agents/<role>/memory/memory.md` with format:

```
## <Positive Pattern|Improvement Note> (<today's date>)
[Score: X/10] <specific lesson extracted>
Developer feedback: "<original comment>"
```

5. **Confirm** — tell the user what was recorded and for which agent

## Rules
- Be specific in the lesson — extract actionable patterns, not vague praise
- If the feedback applies to multiple agents, update all relevant memory files
- If the feedback is about project-wide behavior, also update `agents/shared/memory/memory.md`
