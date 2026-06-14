/**
 * scanSkillsAgentsCommands.ts — scanners for skills, subagents, and slash
 * commands for the Claude Command Center.
 */

import { readDir, readTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type { ClaudeSkill, ClaudeAgent, ClaudeCommand } from '../../types';
import { parseFrontmatter, stripMdExt, MAX_COMMAND_DEPTH } from './shared';

/** Skills from a `<root>/skills/<dir>/SKILL.md` tree, tagged with `source`. */
export async function scanSkills(skillsDir: string, source: string): Promise<ClaudeSkill[]> {
  if (!(await exists(skillsDir))) return [];
  const entries = await readDir(skillsDir);

  const skills = await Promise.all(
    entries
      .filter((e) => e.isDirectory)
      .map(async (entry): Promise<ClaudeSkill | null> => {
        const dirPath = await join(skillsDir, entry.name);
        const skillMd = await join(dirPath, 'SKILL.md');
        if (!(await exists(skillMd))) return null;
        const md = await readTextFile(skillMd);
        const { data } = parseFrontmatter(md);
        return {
          name: data.name && data.name.length > 0 ? data.name : entry.name,
          description: data.description && data.description.length > 0 ? data.description : null,
          dirName: entry.name,
          path: skillMd,
          source,
        };
      }),
  );

  return skills.filter((s): s is ClaudeSkill => s !== null);
}

/** Read one nested-layout agent dir (agents/<name>/AGENT.md). */
async function readNestedAgent(
  agentsDir: string,
  entryName: string,
  source: string,
): Promise<ClaudeAgent | null> {
  const agentMd = await join(agentsDir, entryName, 'AGENT.md');
  if (!(await exists(agentMd))) return null;
  const md = await readTextFile(agentMd);
  const { data } = parseFrontmatter(md);
  return {
    name: data.name && data.name.length > 0 ? data.name : entryName,
    description: data.description && data.description.length > 0 ? data.description : null,
    fileName: `${entryName}/AGENT.md`,
    path: agentMd,
    source,
  };
}

/** Read one flat-layout agent file (agents/<name>.md). */
async function readFlatAgent(
  agentsDir: string,
  entryName: string,
  source: string,
): Promise<ClaudeAgent | null> {
  if (!/\.md$/i.test(entryName)) return null;
  const filePath = await join(agentsDir, entryName);
  const md = await readTextFile(filePath);
  const { data } = parseFrontmatter(md);
  const fallback = stripMdExt(entryName);
  return {
    name: data.name && data.name.length > 0 ? data.name : fallback,
    description: data.description && data.description.length > 0 ? data.description : null,
    fileName: entryName,
    path: filePath,
    source,
  };
}

/**
 * Subagents from a `<root>/agents` dir, tagged with `source`. Handles BOTH
 * layouts seen in the wild:
 *   - flat:   agents/<name>.md            (user dir, most CC plugins)
 *   - nested: agents/<name>/AGENT.md      (e.g. bigbang-crew personas)
 * Nested dirs without an AGENT.md contribute nothing.
 */
export async function scanAgents(agentsDir: string, source: string): Promise<ClaudeAgent[]> {
  if (!(await exists(agentsDir))) return [];
  const entries = await readDir(agentsDir);

  const agents = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory
        ? readNestedAgent(agentsDir, entry.name, source)
        : readFlatAgent(agentsDir, entry.name, source),
    ),
  );

  return agents.filter((a): a is ClaudeAgent => a !== null);
}

/** Read description from a command *.md file, returning null on failure. */
async function readCommandDescription(childPath: string): Promise<string | null> {
  try {
    const md = await readTextFile(childPath);
    const { data } = parseFrontmatter(md);
    return data.description && data.description.length > 0 ? data.description : null;
  } catch {
    return null;
  }
}

/**
 * Slash commands: a depth-guarded recursive walk of ~/.claude/commands for
 * `*.md`. The command name is namespaced from the subdir path, e.g. "git/commit".
 */
export async function scanCommands(commandsDir: string, source: string): Promise<ClaudeCommand[]> {
  if (!(await exists(commandsDir))) return [];

  const out: ClaudeCommand[] = [];

  async function walk(dir: string, prefix: string, depth: number): Promise<void> {
    if (depth > MAX_COMMAND_DEPTH) return;
    let entries;
    try {
      entries = await readDir(dir);
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const childPath = await join(dir, entry.name);
        if (entry.isDirectory) {
          const nextPrefix = prefix.length > 0 ? prefix + '/' + entry.name : entry.name;
          await walk(childPath, nextPrefix, depth + 1);
        } else if (/\.md$/i.test(entry.name)) {
          const base = stripMdExt(entry.name);
          const name = prefix.length > 0 ? prefix + '/' + base : base;
          const description = await readCommandDescription(childPath);
          out.push({ name, description, path: childPath, source });
        }
      }),
    );
  }

  await walk(commandsDir, '', 0);
  return out;
}
