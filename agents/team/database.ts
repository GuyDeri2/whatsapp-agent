import { BaseAgent } from '../base-agent';
import { AgentRole } from '../types';

export class DatabaseAgent extends BaseAgent {
  readonly role: AgentRole = 'database';
  readonly roleLabel = 'Database Architect';
  // Role definition lives in: agents/database/README.md
  // Skills reference:         agents/database/skills/skills.md
  // Learned memory:           agents/database/memory/memory.md
}
