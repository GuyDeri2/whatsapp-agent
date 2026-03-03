import { BaseAgent } from '../base-agent';
import { AgentRole } from '../types';

export class UXAgent extends BaseAgent {
  readonly role: AgentRole = 'ux';
  readonly roleLabel = 'UX Designer';
  // Role definition lives in: agents/ux/README.md
  // Skills reference:         agents/ux/skills/skills.md
  // Learned memory:           agents/ux/memory/memory.md
}
