// ═══════════════════════════════════════════════════════════════
//  Base Agent — Abstract class for all AI dev team members
//  Every agent:
//   1. Loads its role definition from <role>/README.md
//   2. Loads its own memory + shared project context
//   3. Builds a rich system prompt
//   4. Calls the DeepSeek API (or compatible LLM)
//   5. Returns a structured result
// ═══════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { AgentRole, AgentTask, AgentResult } from './types';
import { loadMemory } from './memory-manager';

// ─── LLM client singleton ─────────────────────────────────────
let _ai: OpenAI | null = null;

export function getAI(): OpenAI {
  if (!_ai) {
    // Default: DeepSeek via OpenAI-compatible API
    // Override with ANTHROPIC_API_KEY + model env vars for Claude
    _ai = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY!,
      baseURL: 'https://api.deepseek.com',
    });
  }
  return _ai;
}

export const LLM_MODEL = process.env.AGENT_LLM_MODEL ?? 'deepseek-chat';

// ─── Base Agent ───────────────────────────────────────────────
export abstract class BaseAgent {
  abstract readonly role: AgentRole;
  abstract readonly roleLabel: string;

  /**
   * Load the agent's role definition from its README.md file.
   * Falls back to a minimal prompt if the file doesn't exist.
   */
  protected loadBasePrompt(): string {
    const readmePath = path.join(__dirname, this.role, 'README.md');
    if (fs.existsSync(readmePath)) {
      return fs.readFileSync(readmePath, 'utf-8').trim();
    }
    return `You are the **${this.roleLabel}** on a WhatsApp AI Agent SaaS platform.`;
  }

  /**
   * Build the full system prompt:
   * role definition (from README.md) + shared project context + personal memory
   */
  protected buildSystemPrompt(): string {
    const basePrompt = this.loadBasePrompt();
    const sharedMemory = loadMemory('shared');
    const personalMemory = loadMemory(this.role);

    let prompt = basePrompt;

    if (sharedMemory) {
      prompt += `\n\n## Shared Project Context\n${sharedMemory}`;
    }

    if (personalMemory) {
      prompt += `\n\n## Your Personal Memory & Learned Patterns\n${personalMemory}`;
    }

    prompt += `\n\n## Output Format
- Be concise and actionable.
- Use code blocks when providing code.
- Use numbered lists for multi-step plans.
- Reference exact file paths when relevant (e.g. src/components/MyComponent.tsx).
- If a task is outside your expertise, say so and defer to the appropriate agent.`;

    return prompt;
  }

  /**
   * Execute a task assigned by the PM.
   */
  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    const systemPrompt = this.buildSystemPrompt();

    const userMessage = [
      `**Task:** ${task.instruction}`,
      task.context ? `**Context:** ${task.context}` : null,
      `**Priority:** ${task.priority}`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const completion = await getAI().chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 2500,
        temperature: 0.7,
      });

      const output = completion.choices[0]?.message?.content?.trim() ?? '';

      return {
        taskId: task.taskId,
        role: this.role,
        output,
        success: true,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        taskId: task.taskId,
        role: this.role,
        output: '',
        success: false,
        error: err.message,
        durationMs: Date.now() - start,
      };
    }
  }
}
