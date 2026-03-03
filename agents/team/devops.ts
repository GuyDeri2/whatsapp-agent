import { BaseAgent } from '../base-agent';
import { AgentRole } from '../types';

export class DevOpsAgent extends BaseAgent {
  readonly role: AgentRole = 'devops';
  readonly roleLabel = 'DevOps Engineer';
  // Role definition lives in: agents/devops/README.md
  // Skills reference:         agents/devops/skills/skills.md
  // Learned memory:           agents/devops/memory/memory.md
}
