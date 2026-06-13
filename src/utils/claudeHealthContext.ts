/**
 * claudeHealthContext.ts — turn a ClaudeInventory into a compact, secret-free
 * digest shaped as AiDayNotesRepo[] (the exact `ai_day_notes` payload the
 * coruro-ai sidecar already accepts).
 *
 * The digest is intentionally NUMBER-LIGHT and SECRET-FREE: it carries env var
 * NAMES only (never values), short server/skill/command identifiers, and
 * truncated hook command previews — never tokens, env values, credentials, or
 * transcript contents. Total size is bounded via capContextLines (~8000 chars).
 *
 * One AiDayNotesRepo entry is emitted per non-empty category section; empty
 * sections are omitted entirely.
 */

import type { ClaudeInventory, AiDayNotesRepo } from '../types';
import { capContextLines } from './dayNotesContext';

/** Hard cap on total digest size handed to the sidecar. */
const MAX_DIGEST_CHARS = 8000;
/** Truncation length for free-text descriptions. */
const DESC_MAX = 70;
/** Cap on how many env var names are listed. */
const ENV_NAMES_MAX = 12;

/** Collapse whitespace and truncate a free-text string for display. */
function shortText(text: string | null | undefined, max = DESC_MAX): string {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/** Append a section only when it has at least one line. */
function pushSection(out: AiDayNotesRepo[], name: string, commits: string[]): void {
  if (commits.length > 0) out.push({ name, commits });
}

/**
 * Build a compact, secret-free digest of the Claude inventory in the shape the
 * sidecar accepts for `ai_day_notes`. Empty sections are omitted; the whole
 * digest is size-bounded via capContextLines.
 */
export function buildClaudeHealthDigest(inv: ClaudeInventory): AiDayNotesRepo[] {
  const sections: AiDayNotesRepo[] = [];

  // --- MCP servers: "<name> (<transport>, <scope>)" ---
  pushSection(
    sections,
    'MCP Servers',
    inv.mcpServers.map((s) => {
      const scope = s.scope === 'project' ? 'project' : 'global';
      return `${s.name} (${s.transport}, ${scope})`;
    }),
  );

  // --- Skills: "<name> — <short description>" ---
  pushSection(
    sections,
    'Skills',
    inv.skills.map((s) => {
      const desc = shortText(s.description);
      return desc ? `${s.name} — ${desc}` : s.name;
    }),
  );

  // --- Subagents ---
  pushSection(
    sections,
    'Subagents',
    inv.agents.map((a) => {
      const desc = shortText(a.description);
      return desc ? `${a.name} — ${desc}` : a.name;
    }),
  );

  // --- Slash commands ---
  pushSection(
    sections,
    'Slash Commands',
    inv.commands.map((c) => {
      const desc = shortText(c.description);
      return desc ? `${c.name} — ${desc}` : c.name;
    }),
  );

  // --- Plugins: "<name> (<enabled/disabled>[, <source>])" ---
  pushSection(
    sections,
    'Plugins',
    inv.plugins.map((p) => {
      const state = p.enabled ? 'enabled' : 'disabled';
      return p.source ? `${p.name} (${state}, ${shortText(p.source, 40)})` : `${p.name} (${state})`;
    }),
  );

  // --- Hooks: "<event>: <preview>" (+ matcher when present) ---
  pushSection(
    sections,
    'Hooks',
    inv.hooks.map((h) => {
      const matcher = h.matcher ? ` [${shortText(h.matcher, 30)}]` : '';
      return `${h.event}${matcher}: ${h.commandPreview}`;
    }),
  );

  // --- Settings: model / permission counts / env NAMES (never values) ---
  if (inv.settings) {
    const settingsLines: string[] = [];
    settingsLines.push(`model: ${inv.settings.model ?? 'default'}`);

    const allow = inv.settings.permissions.allow.length;
    const deny = inv.settings.permissions.deny.length;
    const ask = inv.settings.permissions.ask?.length ?? 0;
    const permParts = [`${allow} allow`, `${deny} deny`];
    if (ask > 0) permParts.push(`${ask} ask`);
    settingsLines.push(`permissions: ${permParts.join(' / ')}`);

    const envKeys = inv.settings.envKeys;
    if (envKeys.length > 0) {
      const shown = envKeys.slice(0, ENV_NAMES_MAX).join(', ');
      const overflow = envKeys.length > ENV_NAMES_MAX ? `, +${envKeys.length - ENV_NAMES_MAX} more` : '';
      settingsLines.push(`env keys: ${shown}${overflow}`);
    }
    pushSection(sections, 'Settings', settingsLines);
  }

  // --- Global memory presence (size only, never the body) ---
  if (inv.globalMemory?.present) {
    pushSection(sections, 'Global Memory', [
      `CLAUDE.md present (${inv.globalMemory.charCount} chars)`,
    ]);
  }

  // --- Sessions: count of projects with transcripts (counts only) ---
  if (inv.sessions.length > 0) {
    const withTranscripts = inv.sessions.filter((s) => s.transcriptCount > 0).length;
    pushSection(sections, 'Sessions', [
      `${inv.sessions.length} projects tracked, ${withTranscripts} with transcripts`,
    ]);
  }

  // --- Scan errors surfaced for health awareness ---
  if (inv.errors.length > 0) {
    pushSection(
      sections,
      'Scan Issues',
      inv.errors.map((e) => shortText(e, 100)),
    );
  }

  return capContextLines(sections, MAX_DIGEST_CHARS);
}
