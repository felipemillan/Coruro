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

import { readDir, readTextFile, exists } from '@tauri-apps/plugin-fs';
import { join, homeDir } from '@tauri-apps/api/path';
import type {
  ClaudeInventory,
  ClaudeMcpServer,
  ClaudeMcpTransport,
  ClaudeSkill,
  ClaudeAgent,
  ClaudeCommand,
  ClaudePlugin,
  ClaudeHook,
  ClaudeSettings,
  ClaudePermissions,
  ClaudeSessionStat,
} from '../types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const MAX_COMMAND_DEPTH = 4;
const MAX_SESSION_DIRS = 200;
const HOOK_PREVIEW_CHARS = 80;

/**
 * Read a JSON file leniently. Tries a strict JSON.parse first; on failure,
 * strips `//` line comments, `/* *​/` block comments, and trailing commas,
 * then re-parses. Returns null on any failure — NEVER throws.
 * Deliberately avoids adding a JSON5 dependency.
 */
async function readJsonLoose<T>(path: string): Promise<T | null> {
  let text: string;
  try {
    text = await readTextFile(path);
  } catch {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    // fall through to lenient parse
  }
  try {
    const cleaned = text
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/(^|[^:])\/\/.*$/gm, '$1') // line comments (avoid http://)
      .replace(/,(\s*[}\]])/g, '$1'); // trailing commas
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

/**
 * Parse simple YAML-style frontmatter. If the file begins with `---\n`, read
 * lines until the next `---`, splitting each on the first `:` and trimming /
 * unquoting the value. Only `name` / `description` are consumed downstream.
 * No frontmatter → `{ data: {}, body: md }`.
 */
function parseFrontmatter(md: string): { data: Record<string, string>; body: string } {
  if (!md.startsWith('---\n')) {
    return { data: {}, body: md };
  }
  const rest = md.slice(4);
  const closeIdx = rest.indexOf('\n---');
  if (closeIdx === -1) {
    return { data: {}, body: md };
  }
  const block = rest.slice(0, closeIdx);
  // body begins after the closing fence's line break
  const afterFence = rest.slice(closeIdx + '\n---'.length);
  const body = afterFence.startsWith('\n') ? afterFence.slice(1) : afterFence;

  const data: Record<string, string> = {};
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key.length > 0) data[key] = value;
  }
  return { data, body };
}

/** Strip a trailing `.md` (case-insensitive) from a filename. */
function stripMdExt(fileName: string): string {
  return fileName.replace(/\.md$/i, '');
}

/** Truncate a command string for safe display in the inventory. */
function previewCommand(command: string): string {
  const trimmed = command.trim();
  return trimmed.length > HOOK_PREVIEW_CHARS
    ? trimmed.slice(0, HOOK_PREVIEW_CHARS - 1) + '…'
    : trimmed;
}

/**
 * Drop the query string / fragment of an MCP endpoint URL: SSE/HTTP transports
 * sometimes carry an auth token there (e.g. `?token=…`). We keep only the
 * origin+path so no secret ever lands in the in-memory inventory.
 */
function redactUrl(rawUrl: string): string {
  const cut = rawUrl.search(/[?#]/);
  return cut === -1 ? rawUrl : rawUrl.slice(0, cut);
}

// --- Loose shapes for the JSON sources (parsed defensively, never trusted) ---

interface RawMcpServer {
  command?: unknown;
  url?: unknown;
  type?: unknown;
}
interface RawClaudeJsonProject {
  mcpServers?: Record<string, RawMcpServer> | undefined;
}
interface RawClaudeJson {
  mcpServers?: Record<string, RawMcpServer> | undefined;
  projects?: Record<string, RawClaudeJsonProject> | undefined;
}
interface RawHookCommand {
  command?: unknown;
}
interface RawHookMatcherGroup {
  matcher?: unknown;
  hooks?: RawHookCommand[] | undefined;
}
interface RawSettings {
  model?: unknown;
  permissions?: {
    allow?: unknown;
    deny?: unknown;
    ask?: unknown;
  } | undefined;
  env?: Record<string, unknown> | undefined;
  hooks?: Record<string, RawHookMatcherGroup[]> | undefined;
  /** Map of "name@marketplace" → enabled flag. */
  enabledPlugins?: Record<string, unknown> | undefined;
}

/** One installed-plugin record from installed_plugins.json (array per key). */
interface RawInstalledPluginEntry {
  installPath?: unknown;
  version?: unknown;
  scope?: unknown;
}
interface RawInstalledPlugins {
  plugins?: Record<string, RawInstalledPluginEntry[]> | undefined;
}

/** Resolved active plugin root used to scan plugin-provided content. */
interface PluginRoot {
  name: string;
  installPath: string;
  enabled: boolean;
}

/** Coerce an unknown into a string array (filtering non-strings). */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Build one ClaudeMcpServer from a raw config entry, inferring transport and
 * command/url. command → stdio; url → http (or sse/http from `type`); else
 * unknown.
 */
function buildMcpServer(
  name: string,
  raw: RawMcpServer,
  scope: 'global' | 'project',
  source: string,
  projectPath?: string,
): ClaudeMcpServer {
  let transport: ClaudeMcpTransport = 'unknown';
  let command: string | null = null;
  let url: string | null = null;

  if (typeof raw.command === 'string') {
    transport = 'stdio';
    command = raw.command;
  } else if (typeof raw.url === 'string') {
    const typeStr = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
    transport = typeStr === 'sse' ? 'sse' : typeStr === 'http' ? 'http' : 'http';
    url = redactUrl(raw.url);
  }

  const server: ClaudeMcpServer = { name, scope, transport, command, url, source };
  if (scope === 'project' && projectPath !== undefined) {
    server.projectPath = projectPath;
  }
  return server;
}

// ---------------------------------------------------------------------------
// Per-category scanners (each returns its slice; the caller wraps in try/catch)
// ---------------------------------------------------------------------------

/**
 * MCP servers from three sources, deduped by scope+project+name:
 *   1. ~/.claude.json top-level `mcpServers` (global)
 *   2. ~/.claude.json `projects[path].mcpServers` (project, cached)
 *   3. each project's checked-in `<path>/.mcp.json` `mcpServers` (project)
 * ~/.claude.json is parsed once and passed in; .mcp.json files are read here.
 */
async function scanMcpServers(claudeJson: RawClaudeJson | null): Promise<ClaudeMcpServer[]> {
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
      if (raw && typeof raw === 'object') add(buildMcpServer(name, raw, scope, 'user', projectPath));
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
          const parsed = await readJsonLoose<{ mcpServers?: Record<string, RawMcpServer> }>(mcpJsonPath);
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

/** Skills from a `<root>/skills/<dir>/SKILL.md` tree, tagged with `source`. */
async function scanSkills(skillsDir: string, source: string): Promise<ClaudeSkill[]> {
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

/**
 * Subagents from a `<root>/agents` dir, tagged with `source`. Handles BOTH
 * layouts seen in the wild:
 *   - flat:   agents/<name>.md            (user dir, most CC plugins)
 *   - nested: agents/<name>/AGENT.md      (e.g. bigbang-crew personas)
 * Nested dirs without an AGENT.md contribute nothing.
 */
async function scanAgents(agentsDir: string, source: string): Promise<ClaudeAgent[]> {
  if (!(await exists(agentsDir))) return [];
  const entries = await readDir(agentsDir);

  const agents = await Promise.all(
    entries.map(async (entry): Promise<ClaudeAgent | null> => {
      // Nested layout: a directory holding an AGENT.md.
      if (entry.isDirectory) {
        const agentMd = await join(agentsDir, entry.name, 'AGENT.md');
        if (!(await exists(agentMd))) return null;
        const md = await readTextFile(agentMd);
        const { data } = parseFrontmatter(md);
        return {
          name: data.name && data.name.length > 0 ? data.name : entry.name,
          description: data.description && data.description.length > 0 ? data.description : null,
          fileName: `${entry.name}/AGENT.md`,
          path: agentMd,
          source,
        };
      }
      // Flat layout: a top-level *.md file.
      if (!/\.md$/i.test(entry.name)) return null;
      const filePath = await join(agentsDir, entry.name);
      const md = await readTextFile(filePath);
      const { data } = parseFrontmatter(md);
      const fallback = stripMdExt(entry.name);
      return {
        name: data.name && data.name.length > 0 ? data.name : fallback,
        description: data.description && data.description.length > 0 ? data.description : null,
        fileName: entry.name,
        path: filePath,
        source,
      };
    }),
  );

  return agents.filter((a): a is ClaudeAgent => a !== null);
}

/**
 * Slash commands: a depth-guarded recursive walk of ~/.claude/commands for
 * `*.md`. The command name is namespaced from the subdir path, e.g. "git/commit".
 */
async function scanCommands(commandsDir: string, source: string): Promise<ClaudeCommand[]> {
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
          let description: string | null = null;
          try {
            const md = await readTextFile(childPath);
            const { data } = parseFrontmatter(md);
            description = data.description && data.description.length > 0 ? data.description : null;
          } catch {
            description = null;
          }
          out.push({ name, description, path: childPath, source });
        }
      }),
    );
  }

  await walk(commandsDir, '', 0);
  return out;
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
async function scanPlugins(
  installedPluginsPath: string,
  enabledPlugins: Record<string, unknown>,
): Promise<{ plugins: ClaudePlugin[]; roots: PluginRoot[] }> {
  const raw = await readJsonLoose<RawInstalledPlugins>(installedPluginsPath);
  const map = raw?.plugins;
  if (!map || typeof map !== 'object') return { plugins: [], roots: [] };

  const plugins: ClaudePlugin[] = [];
  const roots: PluginRoot[] = [];

  for (const [key, records] of Object.entries(map)) {
    const atIdx = key.lastIndexOf('@');
    const name = atIdx === -1 ? key : key.slice(0, atIdx);
    const marketplace = atIdx === -1 ? null : key.slice(atIdx + 1);
    const first = Array.isArray(records) ? records[0] : undefined;
    const installPath = first && typeof first.installPath === 'string' ? first.installPath : null;
    const version = first && typeof first.version === 'string' ? first.version : null;
    // enabledPlugins keys are the full "name@marketplace"; default true.
    const enabledRaw = enabledPlugins[key];
    const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : true;

    plugins.push({ name, marketplace, source: marketplace, version, enabled });
    if (installPath !== null) roots.push({ name, installPath, enabled });
  }

  plugins.sort((a, b) => a.name.localeCompare(b.name));
  return { plugins, roots };
}

/**
 * Scan the skills/agents/commands/mcp content provided by each ENABLED plugin,
 * tagging every item with the plugin name as its `source`. Only the active
 * installPath is read (no stale cached versions), so counts reflect reality.
 * Disabled plugins contribute nothing here (their count still shows on the
 * Plugins card via the enabled/disabled split).
 */
async function scanPluginContents(
  roots: PluginRoot[],
): Promise<{
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

        try {
          if (await exists(mcpJsonPath)) {
            const parsed = await readJsonLoose<{ mcpServers?: Record<string, RawMcpServer> }>(mcpJsonPath);
            const m = parsed?.mcpServers;
            if (m && typeof m === 'object') {
              for (const [srvName, srvRaw] of Object.entries(m)) {
                if (srvRaw && typeof srvRaw === 'object') {
                  mcpServers.push(buildMcpServer(srvName, srvRaw, 'global', root.name));
                }
              }
            }
          }
        } catch {
          // unreadable plugin mcp.json — skip
        }
      }),
  );

  return { skills, agents, commands, mcpServers };
}

/**
 * Hooks from ~/.claude/settings.json `hooks`, plus standalone *-hook-* scripts
 * sitting at the top level of ~/.claude.
 */
async function scanHooks(claudeDir: string, settings: RawSettings | null): Promise<ClaudeHook[]> {
  const out: ClaudeHook[] = [];

  // 1) settings.json hooks object: { <event>: [{ matcher?, hooks: [{ command }] }] }
  const hooksObj = settings?.hooks;
  if (hooksObj && typeof hooksObj === 'object') {
    for (const [event, groups] of Object.entries(hooksObj)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!group || typeof group !== 'object') continue;
        const matcher = typeof group.matcher === 'string' ? group.matcher : null;
        const inner = Array.isArray(group.hooks) ? group.hooks : [];
        for (const h of inner) {
          if (h && typeof h === 'object' && typeof h.command === 'string') {
            out.push({
              event,
              matcher,
              commandPreview: previewCommand(h.command),
              source: 'settings',
            });
          }
        }
      }
    }
  }

  // 2) Standalone scripts at the top level of ~/.claude.
  try {
    const entries = await readDir(claudeDir);
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const isHookScript =
        /-hook-.*\.(sh|py)$/.test(entry.name) ||
        /^stop-hook-/.test(entry.name) ||
        /^session-start-/.test(entry.name);
      if (!isHookScript) continue;
      const scriptPath = await join(claudeDir, entry.name);
      // Derive an event from the filename, e.g. "stop-hook-…" → "Stop",
      // "session-start-…" → "SessionStart".
      let event = 'Unknown';
      const prefixMatch = entry.name.match(/^([a-zA-Z]+)-hook-/);
      if (/^session-start-/.test(entry.name)) {
        event = 'SessionStart';
      } else if (prefixMatch) {
        const p = prefixMatch[1].toLowerCase();
        event = p.charAt(0).toUpperCase() + p.slice(1);
      }
      out.push({
        event,
        commandPreview: previewCommand(entry.name),
        source: 'script',
        scriptPath,
      });
    }
  } catch {
    // top-level listing failed — keep settings-derived hooks only
  }

  return out;
}

/** Resolved settings view (secret-free) from a parsed settings.json. */
function buildSettings(settings: RawSettings | null): ClaudeSettings | null {
  if (settings === null) return null;
  const permissions: ClaudePermissions = {
    allow: toStringArray(settings.permissions?.allow),
    deny: toStringArray(settings.permissions?.deny),
  };
  const ask = toStringArray(settings.permissions?.ask);
  if (ask.length > 0) permissions.ask = ask;

  return {
    model: typeof settings.model === 'string' ? settings.model : null,
    permissions,
    // Env var NAMES only — values are deliberately never captured.
    envKeys: settings.env && typeof settings.env === 'object' ? Object.keys(settings.env) : [],
  };
}

/** Per-project session counts from ~/.claude/projects (transcripts never read). */
async function scanSessions(projectsDir: string): Promise<ClaudeSessionStat[]> {
  if (!(await exists(projectsDir))) return [];
  const dirs = (await readDir(projectsDir)).filter((e) => e.isDirectory).slice(0, MAX_SESSION_DIRS);

  const stats = await Promise.all(
    dirs.map(async (dir): Promise<ClaudeSessionStat> => {
      let transcriptCount = 0;
      try {
        const dirPath = await join(projectsDir, dir.name);
        const files = await readDir(dirPath);
        transcriptCount = files.filter((f) => !f.isDirectory && /\.jsonl$/i.test(f.name)).length;
      } catch {
        transcriptCount = 0;
      }
      return { projectSlug: dir.name, transcriptCount };
    }),
  );

  return stats;
}

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
