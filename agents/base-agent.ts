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
   * Load the agent's skills/code patterns from its skills/skills.md file.
   */
  protected loadSkills(): string {
    const skillsPath = path.join(__dirname, this.role, 'skills', 'skills.md');
    if (fs.existsSync(skillsPath)) {
      return fs.readFileSync(skillsPath, 'utf-8').trim();
    }
    return '';
  }

  /**
   * Build the full system prompt:
   * role definition (from README.md) + skills + shared project context + personal memory
   */
  protected buildSystemPrompt(): string {
    const basePrompt = this.loadBasePrompt();
    const skills = this.loadSkills();
    const sharedMemory = loadMemory('shared');
    const personalMemory = loadMemory(this.role);

    let prompt = basePrompt;

    if (skills) {
      prompt += `\n\n## Skills & Code Patterns Reference\n${skills}`;
    }

    if (sharedMemory) {
      prompt += `\n\n## Shared Project Context\n${sharedMemory}`;
    }

    if (personalMemory) {
      prompt += `\n\n## Your Personal Memory & Learned Patterns\n${personalMemory}`;
    }

    prompt += `\n\n## Output Format
Structure your response with these sections:

### What I Did
Brief summary of what you analyzed, built, or reviewed (1-3 sentences).

### Details
- Use numbered lists for multi-step plans or changes.
- Use code blocks when providing code snippets.
- Reference exact file paths (e.g. src/components/MyComponent.tsx:42).
- Explain WHY you made each decision, not just what.

### Risks & Notes (optional)
Any risks, edge cases, or things the developer should know.

Rules:
- Be concise and actionable — no filler text.
- If a task is outside your expertise, say so and defer to the appropriate agent.
- The developer reading this should know exactly what to do next.`;

    return prompt;
  }

  /**
   * Execute a task assigned by the PM.
   */
  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    const systemPrompt = this.buildSystemPrompt();

    // Setup tools
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "execute_cli_command",
          description: "Execute a command line (CLI) instruction in the project root folder. Use this to deploy, test, lint, or run scripts. The command will run in a real shell environment. You will receive the standard output and standard error.",
          parameters: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "The exact shell command to execute, e.g. 'vercel deploy --prod' or 'npm run check'.",
              },
            },
            required: ["command"],
          },
        },
      },
    ];

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          `**Task:** ${task.instruction}`,
          task.context ? `**Context:** ${task.context}` : null,
          `**Priority:** ${task.priority}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ];

    let finalOutput = '';
    let success = true;
    let toolCallCount = 0;
    const MAX_TOOL_CALLS = 10; // Prevent infinite loops

    try {
      while (true) {
        if (toolCallCount >= MAX_TOOL_CALLS) {
          finalOutput += "\n[System Error]: Reached maximum number of tool iterations. Exiting early.";
          success = false;
          break;
        }

        const completion = await getAI().chat.completions.create({
          model: LLM_MODEL,
          messages,
          max_tokens: 4000,
          temperature: 0.7,
          tools,
        });

        const msg = completion.choices[0]?.message;
        if (!msg) break;

        // Save assistant message exactly as-is to conversation history
        messages.push(msg);

        // Scenario 1: Model completely finished and wants to explicitly reply with string text
        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          finalOutput = msg.content ?? '';
          break; // Done
        }

        // Scenario 2: Model wants to execute a CLI tool
        toolCallCount++;
        for (const toolCall of msg.tool_calls) {
          if (toolCall.function.name === 'execute_cli_command') {
            const { command } = JSON.parse(toolCall.function.arguments);
            let toolStatus = "Success";
            let toolOutput = "";
            let exitCode = 0;

            try {
              // Execute the shell command
              // Using execSync so we immediately block and get the output back.
              // Restricting CWD effectively to workspace root using relative parent mapping.
              const execSync = require('child_process').execSync;
              const result = execSync(command, {
                cwd: path.resolve(__dirname, '..'), // The parent of the agents/ folder (which is the main WhatsApp agent root)
                encoding: 'utf-8',
                timeout: 60000, // 60 second timeout for builds/deploys
                stdio: 'pipe'  // Capture stdout/err
              });
              toolOutput = result;
            } catch (error: any) {
              // ExecSync throws if the process exits with non-zero.
              toolStatus = "Error/Failed";
              exitCode = error.status || 1;
              toolOutput = (error.stdout || '') + '\n' + (error.stderr || '') + '\n' + (error.message || '');
            }

            // Return the tool response exactly formatted back to the assistant
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Status: ${toolStatus}\nExit Code: ${exitCode}\nOutput:\n${toolOutput}`
            });
          }
        }
      } // End while loop

      return {
        taskId: task.taskId,
        role: this.role,
        output: finalOutput,
        success,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        taskId: task.taskId,
        role: this.role,
        output: finalOutput,
        success: false,
        error: err.message,
        durationMs: Date.now() - start,
      };
    }
  }
}
