// Session-report composition for day notes.
//
// The report structure (tiers, metrics, per-repo stats) is computed
// deterministically here; Apple Intelligence contributes only the 1–2 sentence
// executive summary. The on-device model proved unreliable at both arithmetic
// and format-following, so everything verifiable stays in TypeScript.

import type { ActivityEvent, ActivityEventKind } from '../types';

/** Aggregated activity for one repo over the note window. */
export interface RepoActivity {
  name: string;
  /** Committed files (unique) + dirty files changed. */
  filesChanged: number;
  insertions: number;
  deletions: number;
  untracked: number;
  /** Recent commit subjects, newest first (used for the brief description). */
  commitSubjects: string[];
}

export type ActivityTier = 'high' | 'moderate' | 'low' | 'idle';

/**
 * Parse the git_dirty_stat output, e.g.
 *   "2 files changed, 83 insertions(+), 1 deletion(-), 5 untracked"
 *   "3 untracked"
 *   "" (clean)
 */
export function parseDirtyStat(stat: string): {
  files: number;
  insertions: number;
  deletions: number;
  untracked: number;
} {
  const num = (re: RegExp) => {
    const m = stat.match(re);
    return m ? parseInt(m[1], 10) : 0;
  };
  return {
    files: num(/(\d+) files? changed/),
    insertions: num(/(\d+) insertions?\(\+\)/),
    deletions: num(/(\d+) deletions?\(-\)/),
    untracked: num(/(\d+) untracked/),
  };
}

/**
 * Tier rules (mirrors the user-defined report spec):
 *  - idle: no tracked changes, only a handful of untracked files
 *  - high: >500 lines touched, >8 files changed, or 10+ untracked files
 *  - low:  1–2 files and small line counts
 *  - moderate: everything in between
 */
export function classifyActivity(a: RepoActivity): ActivityTier {
  const lines = a.insertions + a.deletions;
  const tracked = a.filesChanged > 0 || lines > 0;
  if (!tracked) return a.untracked >= 10 ? 'high' : 'idle';
  if (lines > 500 || a.filesChanged > 8) return 'high';
  if (a.filesChanged <= 2 && lines < 50) return 'low';
  return 'moderate';
}

/**
 * Strip conventional-commit prefixes (feat:, fix(scope):, etc.) from a
 * commit subject, returning the cleaned prose.
 */
const CONVENTIONAL_PREFIX_RE =
  /^(?:feat|fix|chore|docs|refactor|test|style|perf|build|ci|revert)(?:\([^)]*\))?!?:\s*/i;

function stripConventionalPrefix(s: string): string {
  return s.replace(CONVENTIONAL_PREFIX_RE, '');
}

/** Fallback description when there are no commit subjects, based on tier + stats. */
function describeNoCommits(a: RepoActivity, tier: ActivityTier): string {
  const lines = a.insertions + a.deletions;
  if (tier === 'high') {
    if (a.filesChanged === 0) return 'Many new untracked files';
    if (a.deletions > a.insertions * 2 && lines > 500) return 'Major code reduction';
    if (a.insertions > a.deletions * 2 && lines > 500) return 'Large additions';
    return 'Major uncommitted refactor';
  }
  if (tier === 'moderate') return 'Steady uncommitted progress';
  return 'Minor uncommitted tweaks';
}

/** Brief 2–4 word description derived from real data — never invented. */
function describe(a: RepoActivity, tier: ActivityTier): string {
  if (a.commitSubjects.length >= 2) {
    const first = stripConventionalPrefix(a.commitSubjects[0]);
    const second = stripConventionalPrefix(a.commitSubjects[1]);
    return `${first} and ${second}`;
  }
  if (a.commitSubjects.length === 1) {
    const s = stripConventionalPrefix(a.commitSubjects[0]);
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  }
  return describeNoCommits(a, tier);
}

/**
 * WI-1.6 adaptive scaffold: a single low/idle-tier repo gets a compact one-line
 * note instead of the full tier/metrics/exec-summary skeleton. Returns null when
 * the full report should be composed (≠1 repo, or the lone repo is moderate/high).
 */
function compactSingleRepoNote(
  activities: RepoActivity[],
  date: string,
  appEvents?: ActivityEvent[],
): string | null {
  if (activities.length !== 1) return null;
  const only = activities[0];
  const tier = classifyActivity(only);
  if (tier !== 'low' && tier !== 'idle') return null;
  const lines: string[] = [];
  lines.push(`# 📅 Daily Session Summary — ${date}`);
  lines.push('');
  lines.push(`@${only.name}: ${describe(only, tier)}. ${statsLabel(only)}`.trimEnd());
  if (appEvents && appEvents.length > 0) {
    lines.push('');
    lines.push(...appActivityLines(appEvents));
  }
  return lines.join('\n');
}

/**
 * Group activities into tiers and render the per-repo breakdown bullets. Within
 * each tier, biggest work (by lines touched) leads. Idle repos omit the prose
 * description (no commit subject to lean on).
 */
function tierBreakdownLines(activities: RepoActivity[]): string[] {
  const byTier = new Map<ActivityTier, RepoActivity[]>();
  for (const a of activities) {
    const tier = classifyActivity(a);
    const list = byTier.get(tier) ?? [];
    list.push(a);
    byTier.set(tier, list);
  }

  const out: string[] = [];
  for (const tier of TIER_ORDER) {
    const list = byTier.get(tier);
    if (!list || list.length === 0) continue;
    list.sort((x, y) => y.insertions + y.deletions - (x.insertions + x.deletions));
    out.push('');
    out.push(TIER_HEADERS[tier]);
    for (const a of list) {
      const stats = statsLabel(a);
      out.push(
        tier === 'idle'
          ? `- @${a.name} ${stats}`.trimEnd()
          : `- @${a.name}: ${describe(a, tier)}. ${stats}`.trimEnd(),
      );
    }
  }
  return out;
}

/** "(X files changed, Y insertions(+), Z deletions(-), W untracked)" — zero parts omitted. */
function statsLabel(a: RepoActivity): string {
  const parts: string[] = [];
  if (a.filesChanged > 0)
    parts.push(`${a.filesChanged} file${a.filesChanged === 1 ? '' : 's'} changed`);
  if (a.insertions > 0) parts.push(`${a.insertions} insertion${a.insertions === 1 ? '' : 's'}(+)`);
  if (a.deletions > 0) parts.push(`${a.deletions} deletion${a.deletions === 1 ? '' : 's'}(-)`);
  if (a.untracked > 0) parts.push(`${a.untracked} untracked`);
  return parts.length > 0 ? `(${parts.join(', ')})` : '';
}

/**
 * Number-free qualitative descriptor for the AI executive-summary input.
 * The on-device model parrots any number it sees (and gets the arithmetic
 * wrong), so its input must contain no digits — only characterizations.
 */
export function qualitativeDigest(a: RepoActivity): string | null {
  const lines = a.insertions + a.deletions;
  const tier = classifyActivity(a);
  if (a.filesChanged > 0 || lines > 0) {
    const kind =
      a.deletions > a.insertions * 2
        ? 'mostly deletions and cleanup'
        : a.insertions > a.deletions * 2
          ? 'mostly new code'
          : 'mixed edits';
    const size = tier === 'high' ? 'large' : tier === 'moderate' ? 'moderate' : 'small';
    return `${size} amount of uncommitted work in progress, ${kind}`;
  }
  if (a.untracked > 0) return 'a few new untracked files only';
  return null;
}

/**
 * Neutral placeholder used when no AI executive summary is available: the
 * sidecar never ran (single-repo / app-only / spawn failure) or the sanitizer
 * rejected the output. Intentionally copy-neutral — no product-name references.
 */
export const EXEC_SUMMARY_LOCAL = 'Stats compiled from local git data.';

/**
 * Time-span phrases the small on-device model is told (3× over) never to emit,
 * yet still leaks. Anchored to real temporal units so bare "day"/"week" inside
 * words like "day-notes" is never touched.
 */
const TIME_SPAN_RE = new RegExp(
  [
    'over the (?:past|last) (?:few |couple (?:of )?)?(?:second|minute|hour|day|week|month|morning|afternoon|evening|night)s?',
    'earlier (?:today|this (?:morning|afternoon|evening|week|day|month))',
    'throughout the day',
    'all day(?: long)?',
    'for hours',
    'this (?:morning|afternoon|evening|week|day|month)',
    'today',
    'yesterday',
    'tonight',
  ].join('|'),
  'gi',
);

/**
 * Number stripping for the exec-summary gate (WI-2.2). The old blunt rule
 * (`/\b\d[\d,.]*\b/g`) gutted meaningful tokens — `v2`, `#42`, `P1`, `S3`,
 * `React 19` — turning a real sentence into noise and tripping the fallback.
 *
 * This pass preserves identifier-ish numbers and strips only bare counts:
 *  - `#42`               issue / PR refs
 *  - `v2`, `v1.4`        version tags
 *  - `P1`, `S3`, `web3`  letter-glued identifiers (digit touches a letter)
 *  - `React 19 upgrade`  "Name <version>" in an explicit version context
 * Everything else digit-led (`3`, `7`, `1,209`, `3.5`) is a count → stripped.
 */
const PRESERVE_OR_NUMBER_RE = new RegExp(
  [
    '(', // group 1 = preserve verbatim
    [
      '#\\d[\\d.]*', // #42
      '\\b[vV]\\d[\\d.]*', // v2, v1.4
      '[A-Za-z]\\d[\\dA-Za-z.]*', // P1, S3, web3, s2n, v2
      '\\b[A-Z][a-z]+\\s\\d+(?=\\s+(?:upgrade|release|version|stable|beta|alpha|LTS|landed)\\b)', // React 19 upgrade
    ].join('|'),
    ')',
    '|',
    '\\d[\\d,.]*', // otherwise: a bare count → stripped
  ].join(''),
  'g',
);

/** Strip bare count numbers while preserving version/ref/identifier tokens. */
function stripCountNumbers(input: string): string {
  return input.replace(PRESERVE_OR_NUMBER_RE, (_m, keep) => (keep ? keep : ''));
}

/**
 * Deterministic anti-hallucination gate for the AI executive summary.
 *
 * The report owns every exact stat; the model contributes only narrative. It is
 * begged in three prompt layers to avoid time-span claims and numbers, but a
 * small on-device model leaks anyway. Rather than trust the prompt, verify the
 * output here (the codebase rule: anything verifiable stays in TS):
 *  - strip leaked time-span claims,
 *  - strip stray numeric tokens (any digit in the narrative is parroted/wrong),
 *  - tidy the punctuation/whitespace the removals leave behind.
 * If nothing meaningful survives, degrade to the stats-only fallback sentinel.
 */
export function sanitizeExecSummary(input: string): string {
  let out = stripCountNumbers(input.replace(TIME_SPAN_RE, ''));
  out = out
    .replace(/\s+([,.;:!?])/g, '$1') // space stranded before punctuation
    .replace(/([([])\s+/g, '$1') // space stranded after an opening bracket
    .replace(/\s{2,}/g, ' ') // collapse runs left by removals
    .replace(/^[\s,.;:!?-]+/, '') // orphaned leading punctuation
    .trim();
  // No letters left means the model's contribution was entirely noise.
  if (!/[A-Za-z]/.test(out)) return EXEC_SUMMARY_LOCAL;
  return out;
}

const TIER_HEADERS: Record<ActivityTier, string> = {
  high: '### 🔴 High Activity / Significant Changes',
  moderate: '### 🟡 Moderate Activity',
  low: '### 🟢 Low Activity / Minor Tweaks',
  idle: '### ⚪ Idle / Untracked Only',
};

const TIER_ORDER: ActivityTier[] = ['high', 'moderate', 'low', 'idle'];

/**
 * Humanized label per activity-event kind. This is the ONLY text the App
 * Activity section may emit for a kind — the event's own `label` field is never
 * rendered (it is free-text and only validated for the secret-free invariant).
 * `satisfies Record<…>` makes a missing kind a compile-time error if the union
 * grows, keeping the lookup exhaustive.
 */
const KIND_LABELS = {
  ask_session_started: 'Ask sessions started',
  ask_session_ended: 'Ask sessions ended',
  run_command_fired: 'Run commands fired',
  command_center_opened: 'Command Center opens',
  curator_run: 'Setup Curator runs',
  user_note_written: 'Notes written',
} satisfies Record<ActivityEventKind, string>;

/** Deterministic render order for the per-kind bullets. */
const KIND_ORDER: ActivityEventKind[] = [
  'ask_session_started',
  'ask_session_ended',
  'run_command_fired',
  'command_center_opened',
  'curator_run',
  'user_note_written',
];

/**
 * Render the `## App Activity` section from in-app activity events.
 *
 * Deterministic and secret-free: each line is (humanized kind label + count),
 * plus an optional "Repos touched in-app" line built only from `repoName`
 * slugs. The event's free-text `label` field is NEVER read here, so no prompt
 * body, transcript, or path can leak into the note body.
 */
function appActivityLines(appEvents: ActivityEvent[]): string[] {
  const counts = new Map<ActivityEventKind, number>();
  const repos = new Set<string>();
  for (const e of appEvents) {
    counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    if (e.repoName) repos.add(e.repoName);
  }

  const lines: string[] = [];
  lines.push('## App Activity');
  for (const kind of KIND_ORDER) {
    const count = counts.get(kind);
    if (!count) continue;
    lines.push(`- ${KIND_LABELS[kind]}: ${count}`);
  }
  if (repos.size > 0) {
    const names = [...repos].sort().map((r) => `@${r}`);
    lines.push(`- Repos touched in-app: ${names.join(', ')}`);
  }
  return lines;
}

/**
 * Compose the full session-report markdown.
 * `executiveSummary` is the AI-written narrative (or a fallback placeholder).
 * `appEvents` (optional) appends a deterministic, secret-free App Activity
 * section after the repo breakdown; omitted/empty renders no section.
 * `coverageLabel` (optional, default null) renders as an italic line under
 * the H1 when the window spans more than 24 h — e.g. "Covering activity
 * since Jun 15, 2026". Existing 3-arg and 4-arg callers are unaffected.
 */
export function composeSessionReport(
  activities: RepoActivity[],
  executiveSummary: string,
  generatedAt: Date,
  appEvents?: ActivityEvent[],
  coverageLabel: string | null = null,
): string {
  const totalFiles = activities.reduce((n, a) => n + a.filesChanged, 0);
  const totalIns = activities.reduce((n, a) => n + a.insertions, 0);
  const totalDel = activities.reduce((n, a) => n + a.deletions, 0);

  const date = generatedAt.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // WI-1.6: adaptive scaffold. A single light-activity repo doesn't warrant the
  // full tier / metrics / exec-summary skeleton — emit a compact one-line note so
  // a tiny session reads as a note, not a broken report. High-tier single repos
  // still get the full skeleton below.
  const compact = compactSingleRepoNote(activities, date, appEvents);
  if (compact !== null) return compact;

  const md: string[] = [];
  md.push(`# 📅 Daily Session Summary — ${date}`);
  if (coverageLabel !== null) {
    md.push('');
    md.push(`_${coverageLabel}_`);
  }
  md.push('');
  md.push('## 🚦 Repository Status Breakdown');
  md.push(...tierBreakdownLines(activities));

  md.push('');
  md.push('## Global Activity Metrics');
  md.push(`- Repos touched: ${activities.length}`);
  md.push(`- Files changed: ${totalFiles}`);
  md.push(`- Lines: +${totalIns.toLocaleString()} / -${totalDel.toLocaleString()}`);
  md.push('');
  md.push('## Executive Summary');
  md.push('');
  md.push(executiveSummary);

  if (appEvents && appEvents.length > 0) {
    md.push('');
    md.push(...appActivityLines(appEvents));
  }

  return md.join('\n');
}
