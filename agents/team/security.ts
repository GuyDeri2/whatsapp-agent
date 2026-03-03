import { BaseAgent } from '../base-agent';
import { AgentRole } from '../types';

export class SecurityAgent extends BaseAgent {
  readonly role: AgentRole = 'security';
  readonly roleLabel = 'Security Engineer';
  // Role definition lives in: agents/security/README.md
  // Skills reference:         agents/security/skills/skills.md
  // Learned memory:           agents/security/memory/memory.md
}
