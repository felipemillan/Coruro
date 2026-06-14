/**
 * claudeScanner.ts — read-only inventory scanner for the Claude Command Center.
 *
 * Scans ~/.claude and ~/.claude.json to produce a runtime-only ClaudeInventory:
 * MCP servers, skills, subagents, slash commands, plugins, hooks, settings,
 * global memory presence, and per-project session counts.
 *
 * SECURITY: this scanner is strictly read-only and SECRET-FREE. It records env
 * var NAMES only (never their values), never reads MCP credentials, plugin
 * secrets, or transcript bodies. ~/.claude.json is parsed exactly ONCE.
 *
 * RESILIENCE (mirrors scanner.ts): each category runs inside its own try/catch
 * that pushes a human-readable message into `errors[]` and continues, so one
 * broken or missing source file never aborts the whole scan. Independent work
 * runs via Promise.all.
 */

import { readTextFile, exists } from '@tauri-apps/plugin-fs';
import { join, homeDir } from '@tauri-apps/api/path';
import type {
  ClaudeInventory,
  ClaudeMcpServer,
  ClaudeSkill,
  ClaudeAgent,
  ClaudeCommand,
  ClaudePlugin,
  ClaudeHook,
  ClaudeSettings,
  ClaudeSessionStat,
} from '../types';
import { readJsonLoose } from './claudeScanner/shared';
import type { RawClaudeJson, RawSettings } from './claudeScanner/shared';
import { scanMcpServers } from './claudeScanner/scanMcp';
import { scanSkills, scanAgents, scanCommands } from './claudeScanner/scanSkillsAgentsCommands';
import { scanPlugins, scanPluginContents } from './claudeScanner/scanPlugins';
import { scanHooks, buildSettings } from './claudeScanner/scanHooksSettings';
import { scanSessions } from './claudeScanner/scanSessions';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan ~/.claude and ~/.claude.json into a fresh ClaudeInventory.
 *
 * Each category is isolated in its own try/catch so a single broken/missing
 * source contributes a message to `errors[]` without aborting the scan. The
 * result is runtime-only and SECRET-FREE (env var names only, no values, no
 * transcript bodies, no credentials).
 */
export async function scanClaude(): Promise<ClaudeInventory> {
  const errors: string[] = [];
  const home = await homeDir();
  const claudeDir = await join(home, '.claude');
  const claudeJsonPath = await join(home, '.claude.json');
  const skillsDir = await join(claudeDir, 'skills');
  const agentsDir = await join(claudeDir, 'agents');
  const commandsDir = await join(claudeDir, 'commands');
  const installedPluginsPath = await join(claudeDir, 'plugins', 'installed_plugins.json');
  const settingsPath = await join(claudeDir, 'settings.json');
  const globalMemoryPath = await join(claudeDir, 'CLAUDE.md');
  const projectsDir = await join(claudeDir, 'projects');

  // Parse the two JSON sources ONCE up front.
  const claudeJson = await readJsonLoose<RawClaudeJson>(claudeJsonPath);
  const settings = await readJsonLoose<RawSettings>(settingsPath);

  let mcpServers: ClaudeMcpServer[] = [];
  let skills: ClaudeSkill[] = [];
  let agents: ClaudeAgent[] = [];
  let commands: ClaudeCommand[] = [];
  let plugins: ClaudePlugin[] = [];
  let hooks: ClaudeHook[] = [];
  let resolvedSettings: ClaudeSettings | null = null;
  let globalMemory: { present: boolean; charCount: number } | null = null;
  let sessions: ClaudeSessionStat[] = [];
  // Plugin-provided content is collected separately, then merged AFTER the
  // Promise.all barrier so concurrent reassignment of the local arrays cannot
  // clobber it.
  let pluginContent: {
    skills: ClaudeSkill[];
    agents: ClaudeAgent[];
    commands: ClaudeCommand[];
    mcpServers: ClaudeMcpServer[];
  } = { skills: [], agents: [], commands: [], mcpServers: [] };

  const enabledPlugins =
    settings?.enabledPlugins && typeof settings.enabledPlugins === 'object'
      ? settings.enabledPlugins
      : {};

  await Promise.all([
    (async () => {
      try {
        mcpServers = await scanMcpServers(claudeJson);
      } catch (e) {
        errors.push('MCP scan failed: ' + String(e));
      }
    })(),
    (async () => {
      try {
        skills = await scanSkills(skillsDir, 'local');
      } catch (e) {
        errors.push('Skills scan failed: ' + String(e));
      }
    })(),
    (async () => {
      try {
        agents = await scanAgents(agentsDir, 'local');
      } catch (e) {
        errors.push('Agents scan failed: ' + String(e));
      }
    })(),
    (async () => {
      try {
        commands = await scanCommands(commandsDir, 'local');
      } catch (e) {
        errors.push('Commands scan failed: ' + String(e));
      }
    })(),
    (async () => {
      try {
        const { plugins: p, roots } = await scanPlugins(installedPluginsPath, enabledPlugins);
        plugins = p;
        pluginContent = await scanPluginContents(roots);
      } catch (e) {
        errors.push('Plugins scan failed: ' + String(e));
      }
    })(),
    (async () => {
      try {
        hooks = await scanHooks(claudeDir, settings);
      } catch (e) {
        errors.push('Hooks scan failed: ' + String(e));
      }
    })(),
    (async () => {
      try {
        resolvedSettings = buildSettings(settings);
      } catch (e) {
        errors.push('Settings parse failed: ' + String(e));
      }
    })(),
    (async () => {
      try {
        if (await exists(globalMemoryPath)) {
          const body = await readTextFile(globalMemoryPath);
          globalMemory = { present: true, charCount: body.length };
        } else {
          globalMemory = { present: false, charCount: 0 };
        }
      } catch (e) {
        globalMemory = { present: false, charCount: 0 };
        errors.push('Global memory scan failed: ' + String(e));
      }
    })(),
    (async () => {
      try {
        sessions = await scanSessions(projectsDir);
      } catch (e) {
        errors.push('Sessions scan failed: ' + String(e));
      }
    })(),
  ]);

  // Merge plugin-provided content into the local inventory. Skills/agents/
  // commands simply concatenate (each carries its `source`). MCP servers dedup
  // by name with user config winning over plugin-provided duplicates.
  skills = [...skills, ...pluginContent.skills];
  agents = [...agents, ...pluginContent.agents];
  commands = [...commands, ...pluginContent.commands];
  const seenMcp = new Set(mcpServers.map((s) => s.name));
  for (const srv of pluginContent.mcpServers) {
    if (!seenMcp.has(srv.name)) {
      seenMcp.add(srv.name);
      mcpServers.push(srv);
    }
  }

  return {
    mcpServers,
    skills,
    agents,
    commands,
    plugins,
    hooks,
    settings: resolvedSettings,
    globalMemory,
    sessions,
    scannedAt: new Date().toISOString(),
    errors,
  };
}
