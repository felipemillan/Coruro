/**
 * scanHooksSettings.ts — hooks and settings scanners for the Claude Command Center.
 */

import { readDir } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type { ClaudeHook, ClaudeSettings, ClaudePermissions } from '../../types';
import { previewCommand, toStringArray } from './shared';
import type { RawSettings, RawHookMatcherGroup } from './shared';

/** Extract ClaudeHook entries from one event's matcher-group array. */
function hooksFromGroups(event: string, groups: RawHookMatcherGroup[]): ClaudeHook[] {
  const out: ClaudeHook[] = [];
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    const matcher = typeof group.matcher === 'string' ? group.matcher : null;
    const inner = Array.isArray(group.hooks) ? group.hooks : [];
    for (const h of inner) {
      if (h && typeof h === 'object' && typeof h.command === 'string') {
        out.push({ event, matcher, commandPreview: previewCommand(h.command), source: 'settings' });
      }
    }
  }
  return out;
}

/** Derive a lifecycle event name from a standalone hook script filename. */
function eventFromScriptName(name: string): string {
  if (/^session-start-/.test(name)) return 'SessionStart';
  const m = name.match(/^([a-zA-Z]+)-hook-/);
  if (m) {
    const p = m[1].toLowerCase();
    return p.charAt(0).toUpperCase() + p.slice(1);
  }
  return 'Unknown';
}

/** Scan standalone hook scripts at the top level of the Claude dir. */
async function scanScriptHooks(claudeDir: string): Promise<ClaudeHook[]> {
  const out: ClaudeHook[] = [];
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
      out.push({
        event: eventFromScriptName(entry.name),
        commandPreview: previewCommand(entry.name),
        source: 'script',
        scriptPath,
      });
    }
  } catch {
    // top-level listing failed — return whatever was collected
  }
  return out;
}

/**
 * Hooks from settings.json and standalone scripts at the top level of ~/.claude.
 */
export async function scanHooks(
  claudeDir: string,
  settings: RawSettings | null,
): Promise<ClaudeHook[]> {
  const out: ClaudeHook[] = [];

  // 1) settings.json hooks object: { <event>: [{ matcher?, hooks: [{ command }] }] }
  const hooksObj = settings?.hooks;
  if (hooksObj && typeof hooksObj === 'object') {
    for (const [event, groups] of Object.entries(hooksObj)) {
      if (!Array.isArray(groups)) continue;
      out.push(...hooksFromGroups(event, groups));
    }
  }

  // 2) Standalone scripts at the top level of ~/.claude.
  out.push(...(await scanScriptHooks(claudeDir)));

  return out;
}

/** Resolved settings view (secret-free) from a parsed settings.json. */
export function buildSettings(settings: RawSettings | null): ClaudeSettings | null {
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
