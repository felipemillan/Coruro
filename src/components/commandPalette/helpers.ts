/**
 * helpers.ts — Derives slash/at-invocation strings for each command palette item type.
 */

import type { ClaudeSkill, ClaudeAgent, ClaudeCommand } from '../../types';

/** Derives the slash-invocation string for a skill. */
export function skillInvocation(skill: ClaudeSkill): string {
  // Skills are invoked as /skill-name or /plugin:skill-name.
  // `dirName` is the canonical directory identifier (e.g. "caveman", "pr-review").
  const prefix =
    skill.source !== 'local' ? `/${skill.source}:${skill.dirName}` : `/${skill.dirName}`;
  return prefix;
}

/** Derives the slash-invocation string for an agent. */
export function agentInvocation(agent: ClaudeAgent): string {
  // Agents are subagent types; use @source:name or just the file stem.
  const stem = agent.fileName.replace(/\.md$/i, '');
  return agent.source !== 'local' ? `@${agent.source}:${stem}` : `@${stem}`;
}

/** Derives the slash-invocation string for a command. */
export function commandInvocation(cmd: ClaudeCommand): string {
  return `/${cmd.name}`;
}
