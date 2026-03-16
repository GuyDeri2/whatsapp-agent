#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  AI Dev Team CLI — Main entry point
//
//  Usage:
//    npx tsx agents/run.ts "Add dark mode to settings"
//    npx tsx agents/run.ts feedback frontend 8 "Good code but missing loading state"
//
//  The .env.local from the parent project is loaded automatically.
// ═══════════════════════════════════════════════════════════════

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import readline from 'readline';

// Load .env.local from the project root (one level above agents/)
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

import { PMAgent } from './pm-agent';
import { reviewAndLearn, applyExplicitFeedback } from './reviewer';
import { AgentRole, TaskRunLog } from './types';
import { initMemoryFiles } from './memory-manager';

// ─── ANSI colours ─────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  blue: '\x1b[34m',
};

const LOGS_DIR = path.join(__dirname, 'logs');

// ─── Role display labels & icons ──────────────────────────────
const ROLE_META: Record<string, { label: string; icon: string }> = {
  pm:       { label: 'PM',          icon: '📋' },
  frontend: { label: 'Frontend',    icon: '🎨' },
  backend:  { label: 'Backend',     icon: '⚙️' },
  ux:       { label: 'UX Designer', icon: '✏️' },
  security: { label: 'Security',    icon: '🔒' },
  devops:   { label: 'DevOps',      icon: '🚀' },
  qa:       { label: 'QA',          icon: '🧪' },
  database: { label: 'Database',    icon: '🗄️' },
};

function roleLabel(role: string): string {
  return ROLE_META[role]?.label ?? role.toUpperCase();
}

function roleIcon(role: string): string {
  return ROLE_META[role]?.icon ?? '▪';
}

// ─── Print helpers ─────────────────────────────────────────────
function header(text: string) {
  console.log(`\n${c.bold}${c.cyan}${'═'.repeat(60)}${c.reset}`);
  console.log(`${c.bold}${c.cyan}  ${text}${c.reset}`);
  console.log(`${c.cyan}${'═'.repeat(60)}${c.reset}`);
}

function subHeader(text: string) {
  console.log(`\n${c.bold}${c.blue}  ── ${text} ──${c.reset}`);
}

function agentSection(role: string, taskInstruction: string, success: boolean, durationMs?: number) {
  const icon = roleIcon(role);
  const label = roleLabel(role);
  const indicator = success ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  const duration = durationMs ? ` ${c.dim}(${(durationMs / 1000).toFixed(1)}s)${c.reset}` : '';

  console.log(`\n${c.bold}${indicator} ${icon} ${label}${c.reset}${duration}`);
  console.log(`  ${c.dim}Task: ${taskInstruction.slice(0, 100)}${taskInstruction.length > 100 ? '...' : ''}${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(50)}${c.reset}`);
}

function feedbackLine(role: string, score: number, quality: string) {
  const emoji =
    score >= 9 ? '★' : score >= 7 ? '◆' : score >= 5 ? '▲' : '▼';
  const colour =
    score >= 9 ? c.green : score >= 7 ? c.cyan : score >= 5 ? c.yellow : c.red;
  console.log(
    `  ${colour}${emoji} ${roleLabel(role)}: ${score}/10 — ${quality}${c.reset}`
  );
}

// ─── Interactive input ────────────────────────────────────────
function askUser(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function askMultiline(prompt: string): Promise<string> {
  console.log(prompt);
  console.log(`${c.dim}  (Type your answers. Press Enter twice to submit)${c.reset}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const lines: string[] = [];
  let lastWasEmpty = false;

  return new Promise((resolve) => {
    rl.on('line', (line) => {
      if (line.trim() === '' && lastWasEmpty) {
        rl.close();
        resolve(lines.join('\n').trim());
        return;
      }
      lastWasEmpty = line.trim() === '';
      lines.push(line);
    });
  });
}

// ─── Main: run a task ─────────────────────────────────────────
async function runTask(command: string) {
  // Ensure memory files exist
  const allRoles: (AgentRole | 'shared')[] = [
    'shared', 'pm', 'frontend', 'backend', 'ux', 'security', 'devops', 'qa', 'database',
  ];
  initMemoryFiles(allRoles, {});

  header('AI Dev Team');
  console.log(`\n  ${c.bold}Command:${c.reset} ${command}\n`);

  const pm = new PMAgent();

  // ─── Step 0: Clarification ──────────────────────────────
  console.log(`${c.yellow}⟳ PM is analyzing the request...${c.reset}`);
  const clarification = await pm.clarify(command);
  let clarificationAnswers: string | undefined;

  if (clarification) {
    subHeader('PM has questions before planning');
    console.log('');
    clarification.questions.forEach((q, i) => {
      console.log(`  ${c.bold}${c.cyan}${i + 1}.${c.reset} ${q}`);
    });
    console.log('');

    clarificationAnswers = await askMultiline(`${c.bold}Your answers:${c.reset}`);

    if (!clarificationAnswers) {
      console.log(`${c.dim}No answers provided — PM will proceed with best judgment.${c.reset}`);
    }
  } else {
    console.log(`${c.green}✓ Request is clear — proceeding to plan.${c.reset}`);
  }

  // ─── Step 1: Plan ───────────────────────────────────────
  console.log(`\n${c.yellow}⟳ PM is creating the plan...${c.reset}`);
  const { plan, results, synthesis } = await pm.orchestrate(command, clarificationAnswers);

  subHeader('Plan');
  console.log(`\n  ${c.bold}Summary:${c.reset} ${plan.summary}`);
  if (plan.tasks.length > 0) {
    console.log(`  ${c.bold}Team:${c.reset}`);
    for (const task of plan.tasks) {
      const icon = roleIcon(task.role);
      console.log(`    ${icon} ${c.bold}${roleLabel(task.role)}${c.reset} — ${task.instruction.slice(0, 80)}${task.instruction.length > 80 ? '...' : ''}`);
    }
  }
  if (plan.sequential_groups && plan.sequential_groups.length > 1) {
    console.log(`\n  ${c.dim}Execution: ${plan.sequential_groups.length} sequential groups${c.reset}`);
  } else {
    console.log(`\n  ${c.dim}Execution: all agents in parallel${c.reset}`);
  }

  // ─── Step 2: Agent Results ──────────────────────────────
  header('Agent Outputs');

  // Build task instruction map for display
  const taskMap = new Map(plan.tasks.map(t => [t.taskId, t]));

  for (const result of results) {
    const task = taskMap.get(result.taskId);
    agentSection(
      result.role,
      task?.instruction ?? '(unknown task)',
      result.success,
      result.durationMs
    );

    if (result.success) {
      // Indent agent output for readability
      const lines = result.output.split('\n');
      for (const line of lines) {
        console.log(`  ${line}`);
      }
    } else {
      console.log(`  ${c.red}Error: ${result.error}${c.reset}`);
      if (result.output) {
        console.log(`  ${c.dim}${result.output.slice(0, 200)}${c.reset}`);
      }
    }
  }

  // ─── Step 3: Synthesis ──────────────────────────────────
  header('Implementation Plan');
  console.log(synthesis.implementation_plan);
  console.log(`\n  ${c.bold}Effort:${c.reset} ${synthesis.effort}`);
  if (synthesis.blockers.length > 0) {
    console.log(`\n  ${c.yellow}Blockers:${c.reset}`);
    synthesis.blockers.forEach(b => console.log(`    • ${b}`));
  }
  if (synthesis.pm_notes) {
    console.log(`\n  ${c.dim}PM Notes: ${synthesis.pm_notes}${c.reset}`);
  }

  // ─── Step 4: Auto-review & learning ─────────────────────
  console.log(`\n${c.yellow}⟳ Running feedback loop...${c.reset}`);
  const reviewerOutput = await reviewAndLearn(command, plan, results, synthesis);

  if (reviewerOutput.feedbacks.length > 0) {
    subHeader('Feedback & Learning');
    for (const fb of reviewerOutput.feedbacks) {
      feedbackLine(fb.role, fb.score, fb.quality);
      if (fb.what_to_improve) {
        console.log(`    ${c.dim}→ ${fb.what_to_improve}${c.reset}`);
      }
      if (fb.memory_update) {
        console.log(`    ${c.magenta}💾 Memory updated${c.reset}`);
      }
    }
    if (reviewerOutput.pm_learning) {
      console.log(`  ${c.magenta}💾 PM memory updated${c.reset}`);
    }
  }

  // ─── Step 5: Save run log ───────────────────────────────
  const runId = crypto.randomBytes(4).toString('hex');
  const log: TaskRunLog = {
    runId,
    timestamp: new Date().toISOString(),
    command,
    plan,
    results,
    synthesis,
    feedbacks: reviewerOutput.feedbacks,
  };

  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const logFile = path.join(LOGS_DIR, `${runId}.json`);
  fs.writeFileSync(logFile, JSON.stringify(log, null, 2), 'utf-8');

  console.log(`\n${c.dim}Run saved: agents/logs/${runId}.json${c.reset}`);
  console.log(
    `${c.dim}Tip: give explicit feedback with:${c.reset}\n` +
    `  ${c.cyan}npx tsx agents/run.ts feedback <role> <score 1-10> "<comment>"${c.reset}\n`
  );
}

// ─── Main: explicit feedback ───────────────────────────────────
async function runFeedback(
  role: string,
  score: number,
  comment: string
) {
  const validRoles: (AgentRole | 'pm')[] = [
    'pm', 'frontend', 'backend', 'ux', 'security', 'devops', 'qa', 'database',
  ];

  if (!validRoles.includes(role as AgentRole)) {
    console.error(`Invalid role. Choose from: ${validRoles.join(', ')}`);
    process.exit(1);
  }

  if (score < 1 || score > 10) {
    console.error('Score must be between 1 and 10');
    process.exit(1);
  }

  console.log(`\n${c.yellow}Processing explicit feedback for ${role}...${c.reset}`);
  await applyExplicitFeedback(role as AgentRole, score, comment);
  console.log(`${c.green}✓ Memory updated for ${role}${c.reset}\n`);
}

// ─── CLI dispatch ─────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
${c.bold}AI Dev Team CLI${c.reset}

${c.cyan}Run a task:${c.reset}
  npx tsx agents/run.ts "<command>"

${c.cyan}Examples:${c.reset}
  npx tsx agents/run.ts "Add a search bar to the contacts page"
  npx tsx agents/run.ts "Add rate limiting to the API routes"
  npx tsx agents/run.ts "Improve the onboarding flow for new tenants"

${c.cyan}Give explicit feedback:${c.reset}
  npx tsx agents/run.ts feedback <role> <score 1-10> "<comment>"
  npx tsx agents/run.ts feedback frontend 9 "Great component structure!"
  npx tsx agents/run.ts feedback backend 5 "Missed the RLS policy"

${c.cyan}Roles:${c.reset} pm, frontend, backend, ux, security, devops, qa, database
`);
    process.exit(0);
  }

  if (args[0] === 'feedback') {
    const [, role, scoreStr, ...commentParts] = args;
    const score = parseInt(scoreStr, 10);
    const comment = commentParts.join(' ');

    if (!role || !scoreStr || !comment) {
      console.error('Usage: npx tsx agents/run.ts feedback <role> <score> "<comment>"');
      process.exit(1);
    }

    await runFeedback(role, score, comment);
  } else {
    const command = args.join(' ');
    await runTask(command);
  }
}

main().catch(err => {
  console.error(`\n${c.red}Fatal error:${c.reset}`, err.message);
  process.exit(1);
});
