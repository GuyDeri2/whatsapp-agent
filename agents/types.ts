// ═══════════════════════════════════════════════════════════════
//  AI Dev Team — Shared Types
// ═══════════════════════════════════════════════════════════════

export type AgentRole =
  | 'pm'
  | 'frontend'
  | 'backend'
  | 'ux'
  | 'security'
  | 'devops'
  | 'qa'
  | 'database';

// ─── Task ─────────────────────────────────────────────────────
export interface AgentTask {
  taskId: string;
  role: AgentRole;
  instruction: string;
  context?: string;
  priority: 'high' | 'medium' | 'low';
}

// ─── Result ───────────────────────────────────────────────────
export interface AgentResult {
  taskId: string;
  role: AgentRole;
  output: string;
  success: boolean;
  error?: string;
  durationMs?: number;
}

// ─── PM Clarification ─────────────────────────────────────────
// Returned when PM needs more info before planning.
export interface PmClarification {
  needs_clarification: true;
  questions: string[];
}

// ─── PM Plan ──────────────────────────────────────────────────
// sequential_groups: ordered list of groups.
// Each group runs in parallel; groups run in order.
// If omitted → all tasks run in parallel.
export interface PmPlan {
  needs_clarification?: false;
  summary: string;
  tasks: AgentTask[];
  sequential_groups?: string[][];
}

// ─── PM Final Synthesis ───────────────────────────────────────
export interface PmSynthesis {
  implementation_plan: string;
  effort: 'XS' | 'S' | 'M' | 'L' | 'XL';
  blockers: string[];
  pm_notes: string;
}

// ─── Feedback & Learning ──────────────────────────────────────
export type FeedbackQuality = 'excellent' | 'good' | 'needs_improvement' | 'poor';

export interface FeedbackEntry {
  taskId: string;
  role: AgentRole;
  quality: FeedbackQuality;
  score: number;            // 1–10
  what_worked: string;
  what_to_improve: string;
  memory_update?: string;   // If non-null, append to agent's memory
}

export interface ReviewerOutput {
  feedbacks: FeedbackEntry[];
  pm_learning?: string;     // If non-null, append to PM's memory
}

// ─── Task Run Log ─────────────────────────────────────────────
export interface TaskRunLog {
  runId: string;
  timestamp: string;
  command: string;
  plan: PmPlan;
  results: AgentResult[];
  synthesis: PmSynthesis;
  feedbacks: FeedbackEntry[];
}
