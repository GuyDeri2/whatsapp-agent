import { BaseAgent } from '../base-agent';
import { AgentRole } from '../types';

export class BackendAgent extends BaseAgent {
  readonly role: AgentRole = 'backend';
  readonly roleLabel = 'Backend Developer';
  // Role definition lives in: agents/backend/README.md
  // Skills reference:         agents/backend/skills/skills.md
  // Learned memory:           agents/backend/memory/memory.md
}
