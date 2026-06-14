/**
 * scanMcp.ts — MCP server scanner for the Claude Command Center.
 *
 * Reads from three sources, deduped by name:
 *   1. ~/.claude.json top-level `mcpServers` (global)
 *   2. ~/.claude.json `projects[path].mcpServers` (project, cached)
 *   3. each project's checked-in `<path>/.mcp.json` `mcpServers` (project)
 */

import { exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type { ClaudeMcpServer } from '../../types';
import { buildMcpServer, readJsonLoose } from './shared';
import type { RawClaudeJson, RawMcpServer } from './shared';

/**
 * MCP servers from three sources, deduped by scope+project+name:
 *   1. ~/.claude.json top-level `mcpServers` (global)
 *   2. ~/.claude.json `projects[path].mcpServers` (project, cached)
 *   3. each project's checked-in `<path>/.mcp.json` `mcpServers` (project)
 * ~/.claude.json is parsed once and passed in; .mcp.json files are read here.
 */
export async function scanMcpServers(claudeJson: RawClaudeJson | null): Promise<ClaudeMcpServer[]> {
  if (claudeJson === null) return [];
  const servers: ClaudeMcpServer[] = [];
  // Dedup by NAME: the same server is cached under every project that has
  // ever used it, so a scope+project+name key inflates the count many-fold.
  // A user cares about how many *distinct* servers exist. Global scope wins
  // over project scope when a name appears in both.
  const byName = new Map<string, ClaudeMcpServer>();
  const add = (s: ClaudeMcpServer): void => {
    const existing = byName.get(s.name);
    if (existing === undefined) {
      byName.set(s.name, s);
      servers.push(s);
      return;
    }
    // Upgrade a previously-seen project entry to global if we now see one.
    if (existing.scope === 'project' && s.scope === 'global') {
      const idx = servers.indexOf(existing);
      if (idx !== -1) servers[idx] = s;
      byName.set(s.name, s);
    }
  };
  const addRecord = (
    record: Record<string, RawMcpServer>,
    scope: 'global' | 'project',
    projectPath?: string,
  ): void => {
    for (const [name, raw] of Object.entries(record)) {
      if (raw && typeof raw === 'object')
        add(buildMcpServer(name, raw, scope, 'user', projectPath));
    }
  };

  const global = claudeJson.mcpServers;
  if (global && typeof global === 'object') addRecord(global, 'global');

  const projects = claudeJson.projects;
  if (projects && typeof projects === 'object') {
    // 2) inline project servers cached in ~/.claude.json
    for (const [projectPath, project] of Object.entries(projects)) {
      const projMcp = project?.mcpServers;
      if (projMcp && typeof projMcp === 'object') addRecord(projMcp, 'project', projectPath);
    }
    // 3) authoritative project servers from each repo's .mcp.json
    await Promise.all(
      Object.keys(projects).map(async (projectPath) => {
        try {
          const mcpJsonPath = await join(projectPath, '.mcp.json');
          if (!(await exists(mcpJsonPath))) return;
          const parsed = await readJsonLoose<{ mcpServers?: Record<string, RawMcpServer> }>(
            mcpJsonPath,
          );
          const m = parsed?.mcpServers;
          if (m && typeof m === 'object') addRecord(m, 'project', projectPath);
        } catch {
          // unreadable / out-of-scope project .mcp.json — skip
        }
      }),
    );
  }

  return servers;
}
