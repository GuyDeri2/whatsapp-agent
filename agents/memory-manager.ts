// ═══════════════════════════════════════════════════════════════
//  Memory Manager — File-based persistent memory per agent
//  Each agent has: agents/<role>/memory/memory.md
//  Shared project context: agents/shared/memory/memory.md
// ═══════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { AgentRole } from './types';

function memoryPath(role: AgentRole | 'shared'): string {
  return path.join(__dirname, role, 'memory', 'memory.md');
}

export function loadMemory(role: AgentRole | 'shared'): string {
  const filePath = memoryPath(role);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8').trim();
}

export function saveMemory(role: AgentRole | 'shared', content: string): void {
  const filePath = memoryPath(role);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Append a new section to the agent's memory file.
 * @param role     Which agent's memory to update
 * @param section  Section heading (e.g. "Learned Pattern")
 * @param content  The content to append
 */
export function appendToMemory(
  role: AgentRole | 'shared',
  section: string,
  content: string
): void {
  const current = loadMemory(role);
  const timestamp = new Date().toISOString().slice(0, 10);
  const newSection = `\n\n## ${section} (${timestamp})\n${content.trim()}`;
  saveMemory(role, current + newSection);
}

/**
 * Ensure all memory directories & files exist with initial content.
 */
export function initMemoryFiles(
  roles: (AgentRole | 'shared')[],
  initialContents: Partial<Record<AgentRole | 'shared', string>>
): void {
  for (const role of roles) {
    const filePath = memoryPath(role);
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const initial = initialContents[role] ?? `# ${role} memory\n\n(empty — will be populated by the reviewer)\n`;
      fs.writeFileSync(filePath, initial, 'utf-8');
    }
  }
}
