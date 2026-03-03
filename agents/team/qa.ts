import { BaseAgent } from '../base-agent';
import { AgentRole } from '../types';

export class QAAgent extends BaseAgent {
  readonly role: AgentRole = 'qa';
  readonly roleLabel = 'QA Engineer';
  // Role definition lives in: agents/qa/README.md
  // Skills reference:         agents/qa/skills/skills.md
  // Learned memory:           agents/qa/memory/memory.md
}
