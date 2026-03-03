// ═══════════════════════════════════════════════════════════════
//  PM Agent — Orchestrator
//  Flow:
//   1. receive command
//   2. create structured plan (which agents, what tasks, order)
//   3. execute tasks (parallel where possible, sequential when needed)
//   4. synthesize all outputs into a final implementation plan
//
//  Role definition: agents/pm/README.md
//  Orchestration skills: agents/pm/skills/orchestration.md
//  Learned memory: agents/pm/memory/memory.md
// ═══════════════════════════════════════════════════════════════

import { BaseAgent, getAI, LLM_MODEL } from './base-agent';
import {
  AgentRole,
  AgentTask,
  AgentResult,
  PmPlan,
  PmSynthesis,
} from './types';
import { loadMemory } from './memory-manager';

// ─── Specialized Agents ───────────────────────────────────────
import { FrontendAgent } from './team/frontend';
import { BackendAgent } from './team/backend';
import { UXAgent } from './team/ux';
import { SecurityAgent } from './team/security';
import { DevOpsAgent } from './team/devops';
import { QAAgent } from './team/qa';

// ─── PM Agent ─────────────────────────────────────────────────
export class PMAgent extends BaseAgent {
  readonly role: AgentRole = 'pm';
  readonly roleLabel = 'Project Manager';
  // Role definition lives in: agents/pm/README.md
  // Orchestration skills:     agents/pm/skills/orchestration.md
  // Learned memory:           agents/pm/memory/memory.md

  // ─── Team map ─────────────────────────────────────────────
  private readonly team: Record<Exclude<AgentRole, 'pm'>, BaseAgent> = {
    frontend: new FrontendAgent(),
    backend: new BackendAgent(),
    ux: new UXAgent(),
    security: new SecurityAgent(),
    devops: new DevOpsAgent(),
    qa: new QAAgent(),
  };

  // ─── Main orchestration entry point ───────────────────────
  async orchestrate(command: string): Promise<{
    plan: PmPlan;
    results: AgentResult[];
    synthesis: PmSynthesis;
  }> {
    const plan = await this.createPlan(command);
    const results = await this.executePlan(plan);
    const synthesis = await this.synthesize(command, plan, results);
    return { plan, results, synthesis };
  }

  // ─── Step 1: Create Plan ───────────────────────────────────
  private async createPlan(command: string): Promise<PmPlan> {
    const basePrompt = this.loadBasePrompt();
    const sharedMemory = loadMemory('shared');
    const pmMemory = loadMemory('pm');

    const systemPrompt = `${basePrompt}

## Project Context
${sharedMemory || '(See team agent README files for project details)'}

## Your PM Memory
${pmMemory || '(No past learnings yet)'}

## Planning Format
You MUST output a single JSON object with this exact structure:
{
  "summary": "One sentence: what will be built/changed",
  "tasks": [
    {
      "taskId": "t1",
      "role": "frontend|backend|ux|security|devops|qa",
      "instruction": "Specific, actionable instruction for this agent",
      "context": "Optional: relevant context, existing code references, constraints",
      "priority": "high|medium|low"
    }
  ],
  "sequential_groups": [
    ["t1", "t2"],
    ["t3"]
  ]
}

sequential_groups rules:
- Each inner array is a group that runs in PARALLEL
- Groups run in ORDER (group 0 finishes before group 1 starts)
- If all tasks can run in parallel, omit sequential_groups or set it to [["t1","t2","t3",...]]
- Only use sequential when later tasks genuinely need earlier results

Output ONLY valid JSON. No markdown fences, no comments.`;

    const completion = await getAI().chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Plan this command: ${command}` },
      ],
      max_tokens: 2000,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
    try {
      return JSON.parse(raw) as PmPlan;
    } catch {
      // Fallback: single task assigned to backend
      console.error('[PM] Failed to parse plan JSON, using fallback plan');
      return {
        summary: command,
        tasks: [
          {
            taskId: 't1',
            role: 'backend',
            instruction: command,
            priority: 'high',
          },
        ],
      };
    }
  }

  // ─── Step 2: Execute Plan ──────────────────────────────────
  private async executePlan(plan: PmPlan): Promise<AgentResult[]> {
    const taskMap = new Map(plan.tasks.map(t => [t.taskId, t]));

    if (!plan.sequential_groups || plan.sequential_groups.length === 0) {
      // All parallel
      return Promise.all(plan.tasks.map(t => this.runTask(t)));
    }

    const results: AgentResult[] = [];

    for (const group of plan.sequential_groups) {
      const groupTasks = group
        .map(id => taskMap.get(id))
        .filter((t): t is AgentTask => t !== undefined);

      const groupResults = await Promise.all(
        groupTasks.map(t => this.runTask(t))
      );
      results.push(...groupResults);
    }

    return results;
  }

  private async runTask(task: AgentTask): Promise<AgentResult> {
    const agent = this.team[task.role as Exclude<AgentRole, 'pm'>];
    if (!agent) {
      return {
        taskId: task.taskId,
        role: task.role,
        output: `No agent found for role: ${task.role}`,
        success: false,
        error: 'Unknown role',
      };
    }
    return agent.execute(task);
  }

  // ─── Step 3: PM Final Synthesis ───────────────────────────
  private async synthesize(
    command: string,
    plan: PmPlan,
    results: AgentResult[]
  ): Promise<PmSynthesis> {
    const agentOutputs = results
      .map(r => `### ${r.role.toUpperCase()} (${r.success ? 'OK' : 'FAILED'})\n${r.output}`)
      .join('\n\n---\n\n');

    const prompt = `You are the PM. Your team has completed their analysis.

Original Command: ${command}

Plan Summary: ${plan.summary}

Team Outputs:
${agentOutputs}

Now synthesize everything into a clear, developer-ready implementation plan.

Output a single JSON object:
{
  "implementation_plan": "Numbered step-by-step plan. Reference exact files. Include code snippets if key. Be specific.",
  "effort": "XS|S|M|L|XL",
  "blockers": ["list of blockers or dependencies that must be resolved first"],
  "pm_notes": "Any important coordination notes, risks, or things the developer should be aware of"
}

Output ONLY valid JSON.`;

    const completion = await getAI().chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: 'You are a senior PM synthesizing a development plan.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2000,
      temperature: 0.4,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
    try {
      return JSON.parse(raw) as PmSynthesis;
    } catch {
      return {
        implementation_plan: 'Failed to parse synthesis. See agent outputs above.',
        effort: 'M',
        blockers: [],
        pm_notes: '',
      };
    }
  }
}
