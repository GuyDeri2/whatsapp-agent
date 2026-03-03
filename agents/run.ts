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
};

const LOGS_DIR = path.join(__dirname, 'logs');

// ─── Role display labels ───────────────────────────────────────
const ROLE_LABELS: Record<string, string> = {
  pm: 'PM',
  frontend: 'Frontend',
  backend: 'Backend',
  ux: 'UX Designer',
  security: 'Security',
  devops: 'DevOps',
  qa: 'QA',
};

// ─── Print helpers ─────────────────────────────────────────────
function header(text: string) {
  console.log(`\n${c.bold}${c.cyan}${'─'.repeat(60)}${c.reset}`);
  console.log(`${c.bold}${c.cyan}  ${text}${c.reset}`);
  console.log(`${c.cyan}${'─'.repeat(60)}${c.reset}`);
}

function section(role: string, success: boolean) {
  const label = ROLE_LABELS[role] ?? role.toUpperCase();
  const indicator = success ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  console.log(`\n${c.bold}${indicator} ${label}${c.reset}`);
  console.log(`${c.dim}${'·'.repeat(40)}${c.reset}`);
}

function feedback(role: string, score: number, quality: string) {
  const emoji =
    score >= 9 ? '★' : score >= 7 ? '◆' : score >= 5 ? '▲' : '▼';
  const colour =
    score >= 9 ? c.green : score >= 7 ? c.cyan : score >= 5 ? c.yellow : c.red;
  console.log(
    `  ${colour}${emoji} ${ROLE_LABELS[role] ?? role}: ${score}/10 — ${quality}${c.reset}`
  );
}

// ─── Main: run a task ─────────────────────────────────────────
async function runTask(command: string) {
  // Ensure memory files exist
  const allRoles: (AgentRole | 'shared')[] = [
    'shared', 'pm', 'frontend', 'backend', 'ux', 'security', 'devops', 'qa',
  ];
  initMemoryFiles(allRoles, {});

  header(`AI Dev Team — Task`);
  console.log(`\n  ${c.bold}Command:${c.reset} ${command}\n`);

  // 1. PM planning
  console.log(`${c.yellow}⟳ PM is planning...${c.reset}`);
  const pm = new PMAgent();
  const { plan, results, synthesis } = await pm.orchestrate(command);

  console.log(`\n${c.bold}Plan:${c.reset} ${plan.summary}`);
  if (plan.tasks.length > 0) {
    console.log(`${c.dim}Tasks: ${plan.tasks.map(t => `${t.role}(${t.taskId})`).join(', ')}${c.reset}`);
  }

  // 2. Agent results
  header('Agent Outputs');
  for (const result of results) {
    section(result.role, result.success);
    if (result.success) {
      console.log(result.output);
    } else {
      console.log(`${c.red}Error: ${result.error}${c.reset}`);
    }
  }

  // 3. PM synthesis
  header('Implementation Plan');
  console.log(synthesis.implementation_plan);
  console.log(`\n${c.bold}Effort:${c.reset} ${synthesis.effort}`);
  if (synthesis.blockers.length > 0) {
    console.log(`${c.yellow}Blockers:${c.reset}`);
    synthesis.blockers.forEach(b => console.log(`  • ${b}`));
  }
  if (synthesis.pm_notes) {
    console.log(`\n${c.dim}PM Notes: ${synthesis.pm_notes}${c.reset}`);
  }

  // 4. Auto-review & learning
  console.log(`\n${c.yellow}⟳ Running feedback loop...${c.reset}`);
  const reviewerOutput = await reviewAndLearn(command, plan, results, synthesis);

  if (reviewerOutput.feedbacks.length > 0) {
    header('Feedback & Learning');
    for (const fb of reviewerOutput.feedbacks) {
      feedback(fb.role, fb.score, fb.quality);
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

  // 5. Save run log
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
    'pm', 'frontend', 'backend', 'ux', 'security', 'devops', 'qa',
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

${c.cyan}Roles:${c.reset} pm, frontend, backend, ux, security, devops, qa
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
