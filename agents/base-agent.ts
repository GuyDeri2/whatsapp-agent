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

    // Setup tools — specialized tools reduce wasted iterations
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file's contents. Use offset/limit for large files. Path is relative to project root.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path relative to project root, e.g. 'session-manager/src/server.ts'" },
              offset: { type: "number", description: "Start line (0-based). Omit to read from start." },
              limit: { type: "number", description: "Max lines to return. Omit to read entire file (capped at 300 lines)." },
            },
            required: ["path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "search_code",
          description: "Search for a pattern in files using grep. Returns matching lines with file paths and line numbers.",
          parameters: {
            type: "object",
            properties: {
              pattern: { type: "string", description: "Regex pattern to search for" },
              path: { type: "string", description: "Directory or file to search in (relative to project root). Default: '.'" },
              include: { type: "string", description: "File glob pattern, e.g. '*.ts' or '*.tsx'" },
            },
            required: ["pattern"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "list_files",
          description: "List files in a directory. Useful for understanding project structure.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Directory path relative to project root. Default: '.'" },
              recursive: { type: "boolean", description: "List recursively. Default: false" },
              include: { type: "string", description: "File glob pattern filter, e.g. '*.ts'" },
            },
            required: [],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "execute_cli_command",
          description: "Execute a shell command in the project root. Use for: npm/npx, git, supabase CLI, deploy commands, tests. Do NOT use for reading files (use read_file) or searching (use search_code).",
          parameters: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "The exact shell command to execute.",
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
          '',
          '**IMPORTANT — Tool usage rules:**',
          '1. PLAN first: before using any tools, briefly state what you need to find and which files/commands you will use.',
          '2. Use `read_file` to read code (NOT `cat` via CLI). Use `search_code` to find patterns (NOT `grep` via CLI).',
          '3. You have a budget of 35 tool calls. Use them wisely — batch related reads together.',
          '4. If you are running low on tool calls, STOP using tools and write your findings based on what you have so far.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ];

    let finalOutput = '';
    let success = true;
    let toolCallCount = 0;
    const MAX_TOOL_CALLS = 35; // Enough for investigation tasks but prevents infinite loops

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

        // Scenario 2: Model wants to use tools
        const projectRoot = path.resolve(__dirname, '..');

        for (const toolCall of msg.tool_calls) {
          toolCallCount++; // Count EACH tool call, not each message

          const fnName = toolCall.function.name;
          let args: any;
          try { args = JSON.parse(toolCall.function.arguments); } catch { args = {}; }

          let toolResult = '';

          try {
            if (fnName === 'read_file') {
              const filePath = path.resolve(projectRoot, args.path || '');
              const content = fs.readFileSync(filePath, 'utf-8');
              const lines = content.split('\n');
              const offset = args.offset || 0;
              const limit = args.limit || 300;
              const slice = lines.slice(offset, offset + limit);
              const totalLines = lines.length;
              toolResult = slice.map((l: string, i: number) => `${offset + i + 1}: ${l}`).join('\n');
              if (offset + limit < totalLines) {
                toolResult += `\n\n[... ${totalLines - offset - limit} more lines. Use offset=${offset + limit} to continue.]`;
              }

            } else if (fnName === 'search_code') {
              const execSync = require('child_process').execSync;
              const searchPath = args.path || '.';
              const includeFlag = args.include ? `--include='${args.include}'` : '';
              const cmd = `grep -rn ${includeFlag} '${args.pattern.replace(/'/g, "\\'")}' '${searchPath}' 2>/dev/null | head -60`;
              toolResult = execSync(cmd, { cwd: projectRoot, encoding: 'utf-8', timeout: 15000, stdio: 'pipe' }) || '(no matches)';

            } else if (fnName === 'list_files') {
              const execSync = require('child_process').execSync;
              const listPath = args.path || '.';
              let cmd: string;
              if (args.recursive) {
                const includeFilter = args.include ? `-name '${args.include}'` : '';
                cmd = `find '${listPath}' -type f ${includeFilter} 2>/dev/null | head -80`;
              } else {
                cmd = `ls -la '${listPath}' 2>/dev/null | head -50`;
              }
              toolResult = execSync(cmd, { cwd: projectRoot, encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }) || '(empty)';

            } else if (fnName === 'execute_cli_command') {
              const execSync = require('child_process').execSync;
              const result = execSync(args.command, {
                cwd: projectRoot,
                encoding: 'utf-8',
                timeout: 120000,
                stdio: 'pipe',
              });
              toolResult = `Status: Success\nOutput:\n${result}`;

            } else {
              toolResult = `Unknown tool: ${fnName}`;
            }
          } catch (error: any) {
            if (fnName === 'execute_cli_command') {
              toolResult = `Status: Error (exit ${error.status || 1})\nOutput:\n${(error.stdout || '') + '\n' + (error.stderr || '')}`;
            } else {
              toolResult = `Error: ${error.message}`;
            }
          }

          // Cap output to prevent context overflow
          if (toolResult.length > 12000) {
            toolResult = toolResult.slice(0, 12000) + '\n\n[... output truncated at 12000 chars]';
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          });
        }

        // Warn agent when running low on budget
        if (toolCallCount >= MAX_TOOL_CALLS - 5 && toolCallCount < MAX_TOOL_CALLS) {
          messages.push({
            role: 'user',
            content: `⚠️ You have ${MAX_TOOL_CALLS - toolCallCount} tool calls remaining. Start writing your final analysis now based on what you've gathered so far.`,
          });
        }
      } // End while loop

      // If we hit the limit, ask for a final summary with what was gathered
      if (toolCallCount >= MAX_TOOL_CALLS && !finalOutput) {
        messages.push({
          role: 'user',
          content: 'Tool call budget exhausted. Write your findings and recommendations based on everything you have gathered so far. Do NOT call any more tools.',
        });
        try {
          const fallback = await getAI().chat.completions.create({
            model: LLM_MODEL,
            messages,
            max_tokens: 4000,
            temperature: 0.5,
          });
          finalOutput = fallback.choices[0]?.message?.content || '[No output generated]';
          success = true; // Partial output is better than no output
        } catch { /* ignore fallback failure */ }
      }

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
