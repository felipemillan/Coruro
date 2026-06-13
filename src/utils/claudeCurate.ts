// claudeCurate.ts — DETERMINISTIC curation findings for the Claude Setup Curator.
//
// SECRET-FREE + HEURISTICS-ONLY GUARANTEE
// ---------------------------------------
// Operates exclusively over structural ClaudeInventory metadata. It never reads
// transcript bodies, env values, raw MCP commands/URLs, or any credential.
// Signals: install-presence, structure (duplicate names across sources, disabled
// plugins), per-project session METADATA (counts, lastModified), and project-
// scoped MCP with no sessions.
//
// All numbers live in CurateFinding.detail / .items and render INSTANTLY without
// any model. The downstream AI layer (ai_curate) only NARRATES qualitatively and
// is fed `title` strings ONLY — never detail or items. Findings render fully even
// when Apple Intelligence is unavailable.

import type {
  ClaudeInventory,
  ClaudeSkill,
  ClaudeAgent,
  ClaudeCommand,
  CurateFinding,
  CurateCategory,
  CuratePayload,
} from '../types';

// ── Exported thresholds ──────────────────────────────────────────────────────
/** A session project is "stale" when its newest transcript is older than this. */
export const STALE_DAYS = 90;
const MS_PER_DAY = 86_400_000;

/**
 * Canonicalize a path or slug to a comparison key tolerant of Claude's slug
 * encoding. Claude stores transcripts under ~/.claude/projects/<slug> where the
 * slug is the absolute path with separators replaced by "-" — and, depending on
 * the path, "." and "_" may also be folded. We collapse EVERY run of non-
 * alphanumeric characters to a single "-" and lowercase, so both an absolute
 * path and a real slug map to the same key. This deliberately over-normalizes
 * to avoid FALSE "remove" findings for project-scoped MCP (a destructive-sounding
 * recommendation); a missed orphan is far cheaper than a wrong one.
 */
function canonical(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Names present with source==='local' AND with some source!=='local'. */
function duplicatedAcrossSource(
  items: ReadonlyArray<ClaudeSkill | ClaudeAgent | ClaudeCommand>,
): string[] {
  const local = new Set<string>();
  const plugin = new Set<string>();
  for (const it of items) {
    if (it.source === 'local') local.add(it.name);
    else plugin.add(it.name);
  }
  return [...local].filter((n) => plugin.has(n));
}

/**
 * Compute deterministic curation findings from the current inventory.
 * Pure + synchronous — safe to call on every render of the Recommendations tab.
 */
export function buildCurateFindings(inv: ClaudeInventory): CurateFinding[] {
  const findings: CurateFinding[] = [];
  const now = Date.now();

  // 1) REMOVE — disabled plugins still installed.
  const disabled = inv.plugins.filter((p) => p.enabled === false);
  if (disabled.length > 0) {
    findings.push({
      id: 'remove:disabled-plugins',
      category: 'remove',
      severity: 'warn',
      title: 'Disabled plugins still installed',
      detail: `${disabled.length} installed plugin(s) are disabled — they add nothing while installed.`,
      items: disabled.map((p) => p.name),
    });
  }

  // 2) CONSOLIDATE — names duplicated across local + a plugin source.
  const dupAll = [
    ...duplicatedAcrossSource(inv.skills).map((n) => `skill: ${n}`),
    ...duplicatedAcrossSource(inv.agents).map((n) => `agent: ${n}`),
    ...duplicatedAcrossSource(inv.commands).map((n) => `command: ${n}`),
  ];
  if (dupAll.length > 0) {
    findings.push({
      id: 'consolidate:duplicate-names',
      category: 'consolidate',
      severity: 'warn',
      title: 'Duplicate names across local and plugin sources',
      detail: `${dupAll.length} item(s) exist both locally and from a plugin; the definitions may collide or shadow each other.`,
      items: dupAll,
    });
  }

  // 3) STALE — session projects untouched beyond STALE_DAYS.
  const stale = inv.sessions.filter(
    (s) => s.lastModified !== null && now - s.lastModified > STALE_DAYS * MS_PER_DAY,
  );
  if (stale.length > 0) {
    findings.push({
      id: 'stale:sessions',
      category: 'stale',
      severity: 'info',
      title: 'Project sessions untouched for a while',
      detail: `${stale.length} project(s) have no transcript activity in over ${STALE_DAYS} days.`,
      items: stale.map((s) => s.projectSlug),
    });
  }

  // 4) STALE — project-scoped MCP whose project has no recorded sessions.
  // Kept `info` (not `warn`) because the slug/path match is heuristic; see canonical().
  const activeKeys = new Set(
    inv.sessions.filter((s) => s.transcriptCount > 0).map((s) => canonical(s.projectSlug)),
  );
  const orphanMcp = inv.mcpServers.filter(
    (m) =>
      m.scope === 'project' &&
      typeof m.projectPath === 'string' &&
      m.projectPath.length > 0 &&
      !activeKeys.has(canonical(m.projectPath)),
  );
  if (orphanMcp.length > 0) {
    findings.push({
      id: 'stale:orphan-project-mcp',
      category: 'stale',
      severity: 'info',
      title: 'Project-scoped MCP servers with no sessions',
      detail: `${orphanMcp.length} project-scoped MCP server(s) belong to projects with no recorded sessions.`,
      items: orphanMcp.map((m) => `${m.name} (${m.projectPath ?? ''})`),
    });
  }

  return findings;
}

const EMPTY_SUMMARY = (): Record<CurateCategory, number> => ({
  remove: 0,
  consolidate: 0,
  stale: 0,
  gap: 0,
  keep: 0,
});

/**
 * Build the secret-free narration payload for ai_curate. Forwards `title` ONLY —
 * `detail` (counts) and `items` (names/paths) are deliberately excluded so the
 * model has nothing numeric to echo and no identifiers to leak. INVARIANT: every
 * finding `title` is count-free (see buildCurateFindings).
 */
export function buildCuratePayload(
  findings: ReadonlyArray<CurateFinding>,
): CuratePayload {
  const summary = EMPTY_SUMMARY();
  for (const f of findings) summary[f.category] += 1;
  return {
    findings: findings.map((f) => ({
      id: f.id,
      category: f.category,
      severity: f.severity,
      title: f.title,
    })),
    summary,
  };
}
