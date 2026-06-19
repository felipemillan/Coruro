// Parse a deterministic "Daily Session Summary" note body back into structured
// data so it can be rendered as a bento grid instead of linear markdown.
//
// The summary markdown is produced by `composeSessionReport`
// (src/utils/sessionReport.ts) with a fixed shape, so parsing it is reliable.
// Anything that is NOT a full daily summary — user-written notes, or the compact
// single-repo note (no `## Global Activity Metrics` section) — returns null so
// the caller can fall back to plain markdown rendering.

export type DailyTier = 'high' | 'moderate' | 'low' | 'idle';

/** One repository's line inside a tier, with stats split into numbers. */
export interface DailyRepoLine {
  name: string;
  /** Prose description (null for idle repos / lines without one). */
  description: string | null;
  /** Original parenthesised stats text, e.g. "5 files changed, 12 insertions(+)". */
  statsText: string | null;
  filesChanged: number;
  insertions: number;
  deletions: number;
  untracked: number;
}

export interface DailyMetrics {
  reposTouched: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/** A single `## App Activity` bullet: humanized label + count (or free text). */
export interface DailyAppEvent {
  label: string;
  value: string;
}

export interface DailyNoteData {
  /** Heading text minus the emoji, e.g. "Daily Session Summary". */
  title: string;
  /** Date string verbatim from the heading, e.g. "Jun 19, 2026". */
  date: string;
  /** Italic coverage line under the H1 when the window spans >24h, else null. */
  coverageLabel: string | null;
  tiers: Record<DailyTier, DailyRepoLine[]>;
  metrics: DailyMetrics;
  executiveSummary: string;
  appActivity: DailyAppEvent[];
}

const TITLE_RE = /^#\s*(?:📅\s*)?(.+?)\s*[—-]\s*(.+?)\s*$/;
const COVERAGE_RE = /^_(.+)_$/;

const TIER_OF_HEADING: Array<[RegExp, DailyTier]> = [
  [/^###\s.*High Activity/i, 'high'],
  [/^###\s.*Moderate Activity/i, 'moderate'],
  [/^###\s.*Low Activity/i, 'low'],
  [/^###\s.*Idle/i, 'idle'],
];

const num = (re: RegExp, s: string): number => {
  const m = s.match(re);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
};

/** Split a `- @name: desc. (stats)` / `- @name (stats)` bullet into a repo line. */
function parseRepoLine(line: string): DailyRepoLine | null {
  const raw = line.replace(/^\s*-\s*@/, '');
  if (raw === line) return null; // not a `- @...` bullet

  let rest = raw;
  let statsText: string | null = null;
  // Greedy to the final ')' so the outer stats group is captured whole — the
  // inner "insertions(+)" / "deletions(-)" parens must not terminate the match.
  const statsMatch = rest.match(/\((.+)\)\s*$/);
  if (statsMatch) {
    statsText = statsMatch[1].trim();
    rest = rest.slice(0, statsMatch.index).trimEnd();
  }

  let name = rest;
  let description: string | null = null;
  const colon = rest.indexOf(': ');
  if (colon !== -1) {
    name = rest.slice(0, colon).trim();
    description =
      rest
        .slice(colon + 2)
        .replace(/\.\s*$/, '')
        .trim() || null;
  }
  name = name.trim();
  if (!name) return null;

  const stats = statsText ?? '';
  return {
    name,
    description,
    statsText,
    filesChanged: num(/(\d[\d,]*) files? changed/, stats),
    insertions: num(/(\d[\d,]*) insertions?\(\+\)/, stats),
    deletions: num(/(\d[\d,]*) deletions?\(-\)/, stats),
    untracked: num(/(\d[\d,]*) untracked/, stats),
  };
}

type Mode = 'none' | 'repos' | 'metrics' | 'exec' | 'app';

/** Map a `## ` heading to its section mode. */
function sectionFor(trimmed: string): Mode {
  if (/Repository Status Breakdown/i.test(trimmed)) return 'repos';
  if (/Global Activity Metrics/i.test(trimmed)) return 'metrics';
  if (/Executive Summary/i.test(trimmed)) return 'exec';
  if (/App Activity/i.test(trimmed)) return 'app';
  return 'none';
}

/** Map a `### ` heading to its tier, or null when it is not a tier heading. */
function tierFor(trimmed: string): DailyTier | null {
  const hit = TIER_OF_HEADING.find(([re]) => re.test(trimmed));
  return hit ? hit[1] : null;
}

/** Parse one `## Global Activity Metrics` bullet into the metrics accumulator. */
function applyMetricLine(m: DailyMetrics, trimmed: string): void {
  if (/Repos touched/i.test(trimmed)) m.reposTouched = num(/(\d[\d,]*)/, trimmed);
  else if (/Files changed/i.test(trimmed)) m.filesChanged = num(/(\d[\d,]*)/, trimmed);
  else if (/Lines/i.test(trimmed)) {
    m.insertions = num(/\+(\d[\d,]*)/, trimmed);
    m.deletions = num(/-(\d[\d,]*)/, trimmed);
  }
}

/** Parse one `## App Activity` bullet into a label/value event. */
function applyAppLine(list: DailyAppEvent[], trimmed: string): void {
  const event = trimmed.replace(/^-\s*/, '');
  const colon = event.indexOf(': ');
  if (colon !== -1) {
    list.push({ label: event.slice(0, colon).trim(), value: event.slice(colon + 2).trim() });
  } else {
    list.push({ label: event.trim(), value: '' });
  }
}

/** Route a content line (non-heading) to the active section's accumulator. */
function applyContentLine(
  mode: Mode,
  trimmed: string,
  data: DailyNoteData,
  tier: DailyTier,
  execLines: string[],
): void {
  if (mode === 'repos' && trimmed.startsWith('-')) {
    const repo = parseRepoLine(trimmed);
    if (repo) data.tiers[tier].push(repo);
  } else if (mode === 'metrics' && trimmed.startsWith('-')) {
    applyMetricLine(data.metrics, trimmed);
  } else if (mode === 'exec' && trimmed) {
    execLines.push(trimmed);
  } else if (mode === 'app' && trimmed.startsWith('-')) {
    applyAppLine(data.appActivity, trimmed);
  }
}

interface ParseState {
  mode: Mode;
  tier: DailyTier;
  sawMetrics: boolean;
}

/** Advance the parse state with one trimmed line, mutating `data`/`execLines`. */
function processLine(
  state: ParseState,
  trimmed: string,
  data: DailyNoteData,
  execLines: string[],
): void {
  if (trimmed.startsWith('# ')) return; // H1 already consumed

  if (state.mode === 'none' && data.coverageLabel === null) {
    const cov = trimmed.match(COVERAGE_RE);
    if (cov) {
      data.coverageLabel = cov[1].trim();
      return;
    }
  }

  if (trimmed.startsWith('## ')) {
    state.mode = sectionFor(trimmed);
    if (state.mode === 'metrics') state.sawMetrics = true;
    return;
  }

  if (trimmed.startsWith('### ')) {
    const t = tierFor(trimmed);
    if (t) state.tier = t;
    return;
  }

  applyContentLine(state.mode, trimmed, data, state.tier, execLines);
}

/**
 * Parse a daily-summary note body. Returns null when the body is not a full
 * daily summary (user note, or compact single-repo note without metrics).
 */
export function parseDailyNote(body: string): DailyNoteData | null {
  const lines = body.split('\n');
  const titleMatch = lines.find((l) => l.startsWith('# '))?.match(TITLE_RE);
  if (!titleMatch) return null;

  const data: DailyNoteData = {
    title: titleMatch[1].replace(/^📅\s*/, '').trim(),
    date: titleMatch[2].trim(),
    coverageLabel: null,
    tiers: { high: [], moderate: [], low: [], idle: [] },
    metrics: { reposTouched: 0, filesChanged: 0, insertions: 0, deletions: 0 },
    executiveSummary: '',
    appActivity: [],
  };

  const state: ParseState = { mode: 'none', tier: 'high', sawMetrics: false };
  const execLines: string[] = [];

  for (const line of lines) {
    processLine(state, line.trim(), data, execLines);
  }

  // A daily summary always carries a metrics section. Compact single-repo notes
  // (and user notes that happen to start with an H1) do not — fall back.
  if (!state.sawMetrics) return null;

  data.executiveSummary = execLines.join(' ').trim();
  return data;
}

/**
 * Derive the "Specific Notables" highlight list from real parsed data: the
 * standout repos by lines touched (high → moderate → low), capped. Honest —
 * nothing invented; a notable is simply the most significant change.
 */
export function deriveNotables(data: DailyNoteData, cap = 4): DailyRepoLine[] {
  const ranked = [...data.tiers.high, ...data.tiers.moderate, ...data.tiers.low]
    .filter((r) => r.insertions + r.deletions + r.filesChanged > 0)
    .sort((a, b) => b.insertions + b.deletions - (a.insertions + a.deletions));
  return ranked.slice(0, cap);
}
