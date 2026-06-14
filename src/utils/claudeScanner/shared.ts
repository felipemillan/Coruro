/**
 * shared.ts — internal helpers, raw types, and constants shared across all
 * claudeScanner sub-modules.
 *
 * SECURITY: everything here is SECRET-FREE. redactUrl strips query-string /
 * fragment. derivePackageHint rejects flag-shaped or secret-shaped tokens.
 */

import { readTextFile } from '@tauri-apps/plugin-fs';
import type { ClaudeMcpServer, ClaudeMcpTransport } from '../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_COMMAND_DEPTH = 4;
export const MAX_SESSION_DIRS = 200;
export const HOOK_PREVIEW_CHARS = 80;

// ---------------------------------------------------------------------------
// Raw shapes (parsed defensively, never trusted)
// ---------------------------------------------------------------------------

export interface RawMcpServer {
  command?: unknown;
  url?: unknown;
  type?: unknown;
  args?: unknown;
}

export interface RawClaudeJsonProject {
  mcpServers?: Record<string, RawMcpServer> | undefined;
}

export interface RawClaudeJson {
  mcpServers?: Record<string, RawMcpServer> | undefined;
  projects?: Record<string, RawClaudeJsonProject> | undefined;
}

export interface RawHookCommand {
  command?: unknown;
}

export interface RawHookMatcherGroup {
  matcher?: unknown;
  hooks?: RawHookCommand[] | undefined;
}

export interface RawSettings {
  model?: unknown;
  permissions?:
    | {
        allow?: unknown;
        deny?: unknown;
        ask?: unknown;
      }
    | undefined;
  env?: Record<string, unknown> | undefined;
  hooks?: Record<string, RawHookMatcherGroup[]> | undefined;
  /** Map of "name@marketplace" → enabled flag. */
  enabledPlugins?: Record<string, unknown> | undefined;
}

/** One installed-plugin record from installed_plugins.json (array per key). */
export interface RawInstalledPluginEntry {
  installPath?: unknown;
  version?: unknown;
  scope?: unknown;
}

export interface RawInstalledPlugins {
  plugins?: Record<string, RawInstalledPluginEntry[]> | undefined;
}

/** Resolved active plugin root used to scan plugin-provided content. */
export interface PluginRoot {
  name: string;
  installPath: string;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Shared utility functions
// ---------------------------------------------------------------------------

/**
 * Read a JSON file leniently. Tries a strict JSON.parse first; on failure,
 * strips line comments, block comments, and trailing commas,
 * then re-parses. Returns null on any failure — NEVER throws.
 * Deliberately avoids adding a JSON5 dependency.
 */
export async function readJsonLoose<T>(path: string): Promise<T | null> {
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
 * Parse simple YAML-style frontmatter. If the file begins with a "---" fence
 * followed by a newline, read lines until the next "---", splitting each on
 * the first colon and trimming / unquoting the value. Only name and
 * description fields are consumed downstream.
 * No frontmatter returns an empty data object with the full text as body.
 */
// eslint-disable-next-line complexity
export function parseFrontmatter(md: string): { data: Record<string, string>; body: string } {
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

/** Strip a trailing .md (case-insensitive) from a filename. */
export function stripMdExt(fileName: string): string {
  return fileName.replace(/\.md$/i, '');
}

/** Truncate a command string for safe display in the inventory. */
export function previewCommand(command: string): string {
  const trimmed = command.trim();
  return trimmed.length > HOOK_PREVIEW_CHARS
    ? trimmed.slice(0, HOOK_PREVIEW_CHARS - 1) + '…'
    : trimmed;
}

/**
 * Drop the query string / fragment of an MCP endpoint URL: SSE/HTTP transports
 * sometimes carry an auth token there (e.g. "?token=..."). We keep only the
 * origin+path so no secret ever lands in the in-memory inventory.
 */
export function redactUrl(rawUrl: string): string {
  const cut = rawUrl.search(/[?#]/);
  return cut === -1 ? rawUrl : rawUrl.slice(0, cut);
}

/** Coerce an unknown into a string array (filtering non-strings). */
export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/** Command names that are generic runners — not informative as a package hint. */
export const MCP_RUNNERS = new Set([
  'npx',
  'uvx',
  'node',
  'python',
  'python3',
  'bunx',
  'bun',
  'deno',
  'sh',
  'bash',
  'env',
  'uv',
]);

/**
 * Derive a SECRET-FREE package/binary identifier from a stdio command + args,
 * to give the enrichment model real signal about what a server is. Only
 * package-shaped tokens are accepted; anything containing "=" (flag values),
 * starting with "-" (flags), or overly long (possible secrets) is rejected, so
 * no credential can leak through. Returns null when nothing identifiable.
 */
// eslint-disable-next-line complexity
export function derivePackageHint(command: string | null, args: unknown): string | null {
  const argList = Array.isArray(args) ? args.filter((a): a is string => typeof a === 'string') : [];
  // 1) A scoped/path-shaped package token (e.g. @scope/server-x or a/b).
  for (const a of argList) {
    if (a.startsWith('-') || a.includes('=') || a.length > 60) continue;
    if (/^@?[\w.-]+\/[\w.@/-]+$/.test(a)) return a;
  }
  // 2) A bare *-mcp / *-server style token.
  for (const a of argList) {
    if (a.startsWith('-') || a.includes('=') || a.length > 40) continue;
    if (/-(mcp|server)$/i.test(a) || /mcp/i.test(a)) return a;
  }
  // 3) A non-runner command binary (e.g. a custom executable name).
  if (command !== null) {
    const base = command.split('/').pop() ?? command;
    if (!MCP_RUNNERS.has(base) && /^[\w.-]+$/.test(base) && base.length <= 40) return base;
  }
  return null;
}

/**
 * Build one ClaudeMcpServer from a raw config entry, inferring transport and
 * command/url. command maps to stdio; url maps to http (or sse/http from the type field); else
 * unknown.
 */
export function buildMcpServer(
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

  const packageHint = transport === 'stdio' ? derivePackageHint(command, raw.args) : null;
  const server: ClaudeMcpServer = { name, scope, transport, command, url, source, packageHint };
  if (scope === 'project' && projectPath !== undefined) {
    server.projectPath = projectPath;
  }
  return server;
}
