import { BaseAgent } from '../base-agent';
import { AgentRole } from '../types';

export class FrontendAgent extends BaseAgent {
  readonly role: AgentRole = 'frontend';
  readonly roleLabel = 'Frontend Developer';
  // Role definition lives in: agents/frontend/README.md
  // Skills reference:         agents/frontend/skills/skills.md
  // Learned memory:           agents/frontend/memory/memory.md
}
