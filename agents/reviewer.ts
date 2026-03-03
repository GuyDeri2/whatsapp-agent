// ═══════════════════════════════════════════════════════════════
//  Reviewer — Post-task LLM that evaluates agent outputs
//  and drives the continuous learning feedback loop.
//
//  Two modes:
//   1. Auto-review: runs after every task automatically
//   2. Explicit feedback: user provides score + comment for a run
//      (via agents/feedback.ts CLI)
// ═══════════════════════════════════════════════════════════════

import { getAI, LLM_MODEL } from './base-agent';
import { AgentResult, PmPlan, PmSynthesis, ReviewerOutput, AgentRole } from './types';
import { appendToMemory } from './memory-manager';

// ─── Auto-review after every run ─────────────────────────────
export async function reviewAndLearn(
  command: string,
  plan: PmPlan,
  results: AgentResult[],
  synthesis: PmSynthesis
): Promise<ReviewerOutput> {
  const agentOutputsStr = results
    .map(r => `[${r.role.toUpperCase()} | ${r.success ? 'OK' : 'FAILED'} | ${r.durationMs ?? 0}ms]\n${r.output}`)
    .join('\n\n---\n\n');

  const prompt = `You are a senior engineering manager reviewing the output of an AI development team.

## Task
Original Command: "${command}"
PM Plan Summary: ${plan.summary}
PM Synthesis Effort: ${synthesis.effort}

## Team Outputs
${agentOutputsStr}

## Your Job
Evaluate EACH agent that participated. For each:
1. Was the task understood correctly?
2. Is the output technically accurate for the stack (Next.js 16, Supabase, Baileys, DeepSeek)?
3. Is it actionable? Does it give the developer enough to work with?
4. What was done well?
5. What should this agent remember or do differently next time?

Also evaluate the PM:
- Was the plan well-structured?
- Were the right agents selected?
- Was the synthesis clear and actionable?

## Output Format
Output a single JSON object:
{
  "feedbacks": [
    {
      "taskId": "t1",
      "role": "frontend",
      "quality": "excellent|good|needs_improvement|poor",
      "score": 8,
      "what_worked": "...",
      "what_to_improve": "...",
      "memory_update": "Specific fact/pattern this agent should remember. Null if nothing notable."
    }
  ],
  "pm_learning": "What the PM should remember about planning tasks like this. Null if nothing notable."
}

Scoring:
- 9-10: Excellent — exactly what was needed, highly actionable
- 7-8: Good — mostly correct, minor gaps
- 5-6: Needs improvement — partial, missing key elements
- 1-4: Poor — missed the point or technically wrong

Output ONLY valid JSON.`;

  try {
    const completion = await getAI().chat.completions.create({
      model: LLM_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a senior engineering manager providing structured feedback on AI agent outputs.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2000,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
    let reviewerOutput: ReviewerOutput = { feedbacks: [] };

    try {
      reviewerOutput = JSON.parse(raw) as ReviewerOutput;
    } catch {
      console.error('[Reviewer] Failed to parse feedback JSON');
      return { feedbacks: [] };
    }

    // Apply memory updates
    await applyMemoryUpdates(reviewerOutput);

    return reviewerOutput;
  } catch (err: any) {
    console.error('[Reviewer] API call failed:', err.message);
    return { feedbacks: [] };
  }
}

// ─── Explicit feedback from developer ────────────────────────
export async function applyExplicitFeedback(
  role: AgentRole | 'pm',
  score: number,
  comment: string
): Promise<void> {
  const prompt = `A developer gave explicit feedback about an AI agent's work.

Agent Role: ${role}
Score: ${score}/10
Developer Comment: "${comment}"

Extract a concrete, reusable memory update for this agent.
What specific pattern, preference, or lesson should this agent remember for future tasks?
Be concise (1-3 sentences max).

Output a single JSON object:
{
  "memory_update": "The specific thing this agent should remember."
}`;

  try {
    const completion = await getAI().chat.completions.create({
      model: LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
    const { memory_update } = JSON.parse(raw);

    if (memory_update) {
      const section = score >= 7 ? 'Positive Pattern' : 'Improvement Note';
      appendToMemory(
        role === 'pm' ? 'pm' : (role as AgentRole),
        section,
        `[Score: ${score}/10] ${memory_update}\nDeveloper feedback: "${comment}"`
      );
      console.log(`[Reviewer] Memory updated for ${role}`);
    }
  } catch (err: any) {
    console.error('[Reviewer] Explicit feedback processing failed:', err.message);
  }
}

// ─── Apply memory updates from auto-review ───────────────────
async function applyMemoryUpdates(reviewerOutput: ReviewerOutput): Promise<void> {
  for (const feedback of reviewerOutput.feedbacks) {
    if (feedback.memory_update) {
      const section =
        feedback.score >= 7 ? 'Positive Pattern' : 'Improvement Note';
      appendToMemory(
        feedback.role as AgentRole,
        section,
        `[Score: ${feedback.score}/10] ${feedback.memory_update}`
      );
    }
  }

  if (reviewerOutput.pm_learning) {
    appendToMemory('pm', 'Planning Pattern', reviewerOutput.pm_learning);
  }
}
