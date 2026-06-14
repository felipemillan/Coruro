// Session-report composition for day notes.
//
// The report structure (tiers, metrics, per-repo stats) is computed
// deterministically here; Apple Intelligence contributes only the 1–2 sentence
// executive summary. The on-device model proved unreliable at both arithmetic
// and format-following, so everything verifiable stays in TypeScript.

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

const TIER_HEADERS: Record<ActivityTier, string> = {
  high: '### 🔴 High Activity / Significant Changes',
  moderate: '### 🟡 Moderate Activity',
  low: '### 🟢 Low Activity / Minor Tweaks',
  idle: '### ⚪ Idle / Untracked Only',
};

const TIER_ORDER: ActivityTier[] = ['high', 'moderate', 'low', 'idle'];

/**
 * Compose the full session-report markdown.
 * `executiveSummary` is the AI-written narrative (or a fallback placeholder).
 */
export function composeSessionReport(
  activities: RepoActivity[],
  executiveSummary: string,
  generatedAt: Date,
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

  return md.join('\n');
}
