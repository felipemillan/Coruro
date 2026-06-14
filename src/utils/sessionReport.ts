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

/** Brief 2–4 word description derived from real data — never invented. */
function describe(a: RepoActivity, tier: ActivityTier): string {
  if (a.commitSubjects.length > 0) {
    const s = a.commitSubjects[0];
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  }
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
 * Placeholder used when the AI executive summary is unavailable or fails the
 * deterministic anti-hallucination gate below. Identical to the spawn-failure
 * fallback in dayNotesSlice so the composed report reads consistently.
 */
export const EXEC_SUMMARY_FALLBACK =
  '_Apple Intelligence summary unavailable — stats compiled locally._';

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
 * A standalone numeric token (1, 7, 1,209, 3.5) — but never digits glued inside
 * an identifier like web3 or s2n (no word boundary there).
 */
const NUMBER_RE = /\b\d[\d,.]*\b/g;

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
  let out = input.replace(TIME_SPAN_RE, '').replace(NUMBER_RE, '');
  out = out
    .replace(/\s+([,.;:!?])/g, '$1') // space stranded before punctuation
    .replace(/([([])\s+/g, '$1') // space stranded after an opening bracket
    .replace(/\s{2,}/g, ' ') // collapse runs left by removals
    .replace(/^[\s,.;:!?-]+/, '') // orphaned leading punctuation
    .trim();
  // No letters left means the model's contribution was entirely noise.
  if (!/[A-Za-z]/.test(out)) return EXEC_SUMMARY_FALLBACK;
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
 */
export function composeSessionReport(
  activities: RepoActivity[],
  executiveSummary: string,
  generatedAt: Date,
  appEvents?: ActivityEvent[],
): string {
  const totalFiles = activities.reduce((n, a) => n + a.filesChanged, 0);
  const totalIns = activities.reduce((n, a) => n + a.insertions, 0);
  const totalDel = activities.reduce((n, a) => n + a.deletions, 0);

  const date = generatedAt.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const md: string[] = [];
  md.push(`# 📅 Daily Session Summary — ${date}`);
  md.push('');
  md.push(`**Executive Summary:** ${executiveSummary}`);
  md.push('');
  md.push('**Global Activity Metrics:**');
  md.push(`- Repos touched: ${activities.length}`);
  md.push(`- Files changed: ${totalFiles}`);
  md.push(`- Lines: +${totalIns.toLocaleString()} / -${totalDel.toLocaleString()}`);
  md.push('');
  md.push('## 🚦 Repository Status Breakdown');

  // Within each tier, sort by lines touched descending so the biggest work leads.
  const byTier = new Map<ActivityTier, RepoActivity[]>();
  for (const a of activities) {
    const tier = classifyActivity(a);
    const list = byTier.get(tier) ?? [];
    list.push(a);
    byTier.set(tier, list);
  }

  for (const tier of TIER_ORDER) {
    const list = byTier.get(tier);
    if (!list || list.length === 0) continue;
    list.sort((x, y) => y.insertions + y.deletions - (x.insertions + x.deletions));
    md.push('');
    md.push(TIER_HEADERS[tier]);
    for (const a of list) {
      const stats = statsLabel(a);
      if (tier === 'idle') {
        md.push(`- @${a.name} ${stats}`.trimEnd());
      } else {
        md.push(`- @${a.name}: ${describe(a, tier)}. ${stats}`.trimEnd());
      }
    }
  }

  if (appEvents && appEvents.length > 0) {
    md.push('');
    md.push(...appActivityLines(appEvents));
  }

  return md.join('\n');
}
