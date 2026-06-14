/**
 * scanPlugins.ts — plugin list and plugin-provided content scanners for the
 * Claude Command Center.
 */

import { exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type {
  ClaudePlugin,
  ClaudeSkill,
  ClaudeAgent,
  ClaudeCommand,
  ClaudeMcpServer,
} from '../../types';
import { buildMcpServer, readJsonLoose } from './shared';
import type {
  RawMcpServer,
  RawInstalledPlugins,
  RawInstalledPluginEntry,
  PluginRoot,
} from './shared';
import { scanSkills, scanAgents, scanCommands } from './scanSkillsAgentsCommands';

/** Read description from a plugin's manifest file, or null on any failure. */
async function readPluginDescription(installPath: string): Promise<string | null> {
  try {
    const manifestPath = await join(installPath, '.claude-plugin', 'plugin.json');
    const manifest = await readJsonLoose<{ description?: unknown }>(manifestPath);
    if (manifest && typeof manifest.description === 'string' && manifest.description.length > 0) {
      return manifest.description;
    }
  } catch {
    // missing/unreadable manifest
  }
  return null;
}

/** Parse a "name@marketplace" plugin key into its two parts. */
function parsePluginKey(key: string): { name: string; marketplace: string | null } {
  const atIdx = key.lastIndexOf('@');
  return atIdx === -1
    ? { name: key, marketplace: null }
    : { name: key.slice(0, atIdx), marketplace: key.slice(atIdx + 1) };
}

/** Extract installPath and version from the first install record. */
function extractInstallInfo(records: RawInstalledPluginEntry[]): {
  installPath: string | null;
  version: string | null;
} {
  const first = Array.isArray(records) ? records[0] : undefined;
  return {
    installPath: first && typeof first.installPath === 'string' ? first.installPath : null,
    version: first && typeof first.version === 'string' ? first.version : null,
  };
}

/** Process one installed-plugin entry key, pushing into plugins/roots arrays. */
async function processPluginEntry(
  key: string,
  records: RawInstalledPluginEntry[],
  enabledPlugins: Record<string, unknown>,
  plugins: ClaudePlugin[],
  roots: PluginRoot[],
): Promise<void> {
  const { name, marketplace } = parsePluginKey(key);
  const { installPath, version } = extractInstallInfo(records);
  // enabledPlugins keys are the full "name@marketplace"; default true.
  const enabledRaw = enabledPlugins[key];
  const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : true;
  const description = installPath !== null ? await readPluginDescription(installPath) : null;

  plugins.push({ name, marketplace, source: marketplace, version, enabled, description });
  if (installPath !== null) roots.push({ name, installPath, enabled });
}

/**
 * Plugins from ~/.claude/plugins/installed_plugins.json. Keys are
 * "name@marketplace"; each value is an array of install records (one per
 * scope). The active version is the first record's installPath/version.
 * Enabled state comes from settings.json `enabledPlugins` (default true when
 * a plugin is installed but absent from the map).
 *
 * Returns both the display list AND the resolved roots, so the caller can scan
 * each enabled plugin's skills/agents/commands/mcp without re-parsing.
 */
export async function scanPlugins(
  installedPluginsPath: string,
  enabledPlugins: Record<string, unknown>,
): Promise<{ plugins: ClaudePlugin[]; roots: PluginRoot[] }> {
  const raw = await readJsonLoose<RawInstalledPlugins>(installedPluginsPath);
  const map = raw?.plugins;
  if (!map || typeof map !== 'object') return { plugins: [], roots: [] };

  const plugins: ClaudePlugin[] = [];
  const roots: PluginRoot[] = [];

  await Promise.all(
    Object.entries(map).map(([key, records]) =>
      processPluginEntry(key, records ?? [], enabledPlugins, plugins, roots),
    ),
  );

  plugins.sort((a, b) => a.name.localeCompare(b.name));
  return { plugins, roots };
}

/** Collect MCP servers from a plugin's mcp.json, pushing into `mcpServers`. */
async function collectPluginMcp(
  mcpJsonPath: string,
  rootName: string,
  mcpServers: ClaudeMcpServer[],
): Promise<void> {
  try {
    if (!(await exists(mcpJsonPath))) return;
    const parsed = await readJsonLoose<{ mcpServers?: Record<string, RawMcpServer> }>(mcpJsonPath);
    const m = parsed?.mcpServers;
    if (!m || typeof m !== 'object') return;
    for (const [srvName, srvRaw] of Object.entries(m)) {
      if (srvRaw && typeof srvRaw === 'object') {
        mcpServers.push(buildMcpServer(srvName, srvRaw, 'global', rootName));
      }
    }
  } catch {
    // unreadable plugin mcp.json — skip
  }
}

/**
 * Scan the skills/agents/commands/mcp content provided by each ENABLED plugin,
 * tagging every item with the plugin name as its `source`. Only the active
 * installPath is read (no stale cached versions), so counts reflect reality.
 * Disabled plugins contribute nothing here (their count still shows on the
 * Plugins card via the enabled/disabled split).
 */
export async function scanPluginContents(roots: PluginRoot[]): Promise<{
  skills: ClaudeSkill[];
  agents: ClaudeAgent[];
  commands: ClaudeCommand[];
  mcpServers: ClaudeMcpServer[];
}> {
  const skills: ClaudeSkill[] = [];
  const agents: ClaudeAgent[] = [];
  const commands: ClaudeCommand[] = [];
  const mcpServers: ClaudeMcpServer[] = [];

  await Promise.all(
    roots
      .filter((r) => r.enabled)
      .map(async (root) => {
        const skillsDir = await join(root.installPath, 'skills');
        const agentsDir = await join(root.installPath, 'agents');
        const commandsDir = await join(root.installPath, 'commands');
        const mcpJsonPath = await join(root.installPath, 'mcp.json');

        const [s, a, c] = await Promise.all([
          scanSkills(skillsDir, root.name).catch(() => [] as ClaudeSkill[]),
          scanAgents(agentsDir, root.name).catch(() => [] as ClaudeAgent[]),
          scanCommands(commandsDir, root.name).catch(() => [] as ClaudeCommand[]),
        ]);
        skills.push(...s);
        agents.push(...a);
        commands.push(...c);

        await collectPluginMcp(mcpJsonPath, root.name, mcpServers);
      }),
  );

  return { skills, agents, commands, mcpServers };
}
