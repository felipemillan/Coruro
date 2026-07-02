// appStateValidation.ts — pure, defensive validators for the persisted AppState.
//
// A corrupt or hand-edited ~/.repo_dashboard_state.json must never crash
// hydration: every slice is coerced back to a well-typed value, dropping only
// the malformed parts. Extracted from useBoardStore so each slice validator is
// small, independently testable, and free of the store's runtime concerns.

import {
  type AppState,
  type ColumnId,
  type RepoGitHub,
  type DayNote,
  type ChatSession,
  type ActivityEvent,
  type ActivityEventKind,
  type PublisherIntent,
  type PublisherModel,
  type PublisherHistoryEntry,
  type PublisherVariation,
  type PublisherRole,
  type PublisherSeniority,
  type PublisherBrief,
  type TerminalModel,
  COLUMN_IDS,
  MAX_PUBLISHER_HISTORY,
  MAX_PUBLISHER_AUDIENCE_LEN,
  MAX_PUBLISHER_ANSWER_LEN,
  MAX_PUBLISHER_ANSWERS,
} from '../types';

type Settings = AppState['settings'];
type PublisherTarget = Settings['publisherDefaultTarget'];
type PostFormat = Settings['publisherDefaultFormat'];

/** Max persisted length for the free-text author-voice prompt. */
const MAX_AUTHOR_VOICE_LEN = 2000;

/** The six confirmed Publisher networks. */
const PUBLISHER_TARGETS = new Set<PublisherTarget>([
  'linkedin',
  'x',
  'instagram',
  'tiktok',
  'facebook',
  'reddit',
]) satisfies Set<PublisherTarget>;

/** The five confirmed post formats. */
const POST_FORMATS = new Set<PostFormat>([
  'single',
  'thread',
  'carousel',
  'story',
  'script',
]) satisfies Set<PostFormat>;

/**
 * Set of all valid publisher intents, asserted in-sync with the union via
 * `satisfies Set<PublisherIntent>` (drift guard; mirrors ACTIVITY_EVENT_KINDS).
 */
const PUBLISHER_INTENTS = new Set<PublisherIntent>([
  'story',
  'lesson',
  'launch',
  'behind_scenes',
  'deep_dive',
  'feedback',
  'milestone',
  'hot_take',
]) satisfies Set<PublisherIntent>;

/**
 * Set of all valid publisher models, asserted in-sync with the union via
 * `satisfies Set<PublisherModel>`. These are MATCH KEYS only — never args.
 */
const PUBLISHER_MODELS = new Set<PublisherModel>([
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
]) satisfies Set<PublisherModel>;

/** All valid publisher roles, drift-guarded against PublisherRole union. */
const PUBLISHER_ROLES_SET = new Set<PublisherRole>([
  'vibe-coder',
  'founder',
  'cto',
  'developer',
  'cmo',
  'growth-marketer',
  'designer',
  'devrel',
]) satisfies Set<PublisherRole>;

/** All valid publisher seniorities, drift-guarded against PublisherSeniority union. */
const PUBLISHER_SENIORITIES_SET = new Set<PublisherSeniority>([
  'junior',
  'mid',
  'senior',
  'lead',
  'exec',
]) satisfies Set<PublisherSeniority>;

/**
 * Set of all valid terminal models, asserted in-sync with the union via
 * `satisfies Set<TerminalModel>` (drift guard; mirrors PUBLISHER_MODELS).
 * These are MATCH KEYS only — never args.
 */
const TERMINAL_MODELS_SET = new Set<TerminalModel>([
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-fable-5',
]) satisfies Set<TerminalModel>;

/**
 * Coerce the enum-ish Publisher defaults: each must be a member of its known
 * Set or the existing default is kept. Split out of applyStringSettings to keep
 * each validator's cyclomatic complexity within the lint budget.
 */
function applyPublisherDefaults(s: Record<string, unknown>, base: Settings): void {
  const pdt = s.publisherDefaultTarget;
  if (typeof pdt === 'string' && PUBLISHER_TARGETS.has(pdt as PublisherTarget)) {
    base.publisherDefaultTarget = pdt as PublisherTarget;
  }
  const pdf = s.publisherDefaultFormat;
  if (typeof pdf === 'string' && POST_FORMATS.has(pdf as PostFormat)) {
    base.publisherDefaultFormat = pdf as PostFormat;
  }
  const pdi = s.publisherDefaultIntent;
  if (typeof pdi === 'string' && PUBLISHER_INTENTS.has(pdi as PublisherIntent)) {
    base.publisherDefaultIntent = pdi as PublisherIntent;
  }
  const pdm = s.publisherDefaultModel;
  if (typeof pdm === 'string' && PUBLISHER_MODELS.has(pdm as PublisherModel)) {
    base.publisherDefaultModel = pdm as PublisherModel;
  }
  applyPublisherBriefDefaults(s, base);
}

function applyPublisherBriefDefaults(s: Record<string, unknown>, base: Settings): void {
  const pdr = s.publisherDefaultRoles;
  if (Array.isArray(pdr)) {
    const filtered = pdr.filter(
      (r): r is PublisherRole =>
        typeof r === 'string' && PUBLISHER_ROLES_SET.has(r as PublisherRole),
    );
    if (filtered.length > 0) base.publisherDefaultRoles = filtered;
  }
  const pds = s.publisherDefaultSeniority;
  if (typeof pds === 'string' && PUBLISHER_SENIORITIES_SET.has(pds as PublisherSeniority)) {
    base.publisherDefaultSeniority = pds as PublisherSeniority;
  }
  const pda = s.publisherDefaultAudience;
  if (typeof pda === 'string') {
    base.publisherDefaultAudience = pda.slice(0, MAX_PUBLISHER_AUDIENCE_LEN);
  }
}

/** rootDirectory accepts any string; the rest must be non-empty. */
function applyStringSettings(s: Record<string, unknown>, base: Settings): void {
  if (typeof s.rootDirectory === 'string') base.rootDirectory = s.rootDirectory;
  for (const k of ['editorCommand', 'editorApp', 'terminalApp'] as const) {
    const v = s[k];
    if (typeof v === 'string' && v.length > 0) base[k] = v;
  }
  // publisherAuthorVoice accepts any string; cap (truncate) overlong input.
  const pav = s.publisherAuthorVoice;
  if (typeof pav === 'string') {
    base.publisherAuthorVoice = pav.slice(0, MAX_AUTHOR_VOICE_LEN);
  }
  applyPublisherDefaults(s, base);
  const tdm = s.terminalDefaultModel;
  if (typeof tdm === 'string' && TERMINAL_MODELS_SET.has(tdm as TerminalModel)) {
    base.terminalDefaultModel = tdm as TerminalModel;
  }
}

function applyBooleanSettings(s: Record<string, unknown>, base: Settings): void {
  for (const k of [
    'hasToken',
    'debugBannerEnabled',
    'autoNotesEnabled',
    'bellAudioEnabled',
    'bellVisualEnabled',
  ] as const) {
    if (typeof s[k] === 'boolean') base[k] = s[k] as boolean;
  }
  const tt = s.terminalTheme;
  if (tt === 'mocha' || tt === 'latte') base.terminalTheme = tt;
}

/** Finite, in-range minute intervals only (refresh ≥ 0, autoNotes > 0). */
function applyNumericSettings(s: Record<string, unknown>, base: Settings): void {
  const refresh = s.refreshIntervalMin;
  if (typeof refresh === 'number' && Number.isFinite(refresh) && refresh >= 0) {
    base.refreshIntervalMin = refresh;
  }
  const auto = s.autoNotesIntervalMin;
  if (typeof auto === 'number' && Number.isFinite(auto) && auto > 0) {
    base.autoNotesIntervalMin = auto;
  }
}

/** Keep only correctly-typed setting primitives; fall back to the default. */
export function validateSettings(raw: unknown, base: Settings): Settings {
  if (typeof raw !== 'object' || raw === null) return base;
  const s = raw as Record<string, unknown>;
  applyStringSettings(s, base);
  applyBooleanSettings(s, base);
  applyNumericSettings(s, base);
  return base;
}

/** Every column must be a string[]; coerce anything else to []. */
export function validateBoard(raw: unknown, base: AppState['board']): AppState['board'] {
  if (typeof raw !== 'object' || raw === null) return base;
  const b = raw as Record<string, unknown>;
  for (const col of COLUMN_IDS as readonly ColumnId[]) {
    const arr = b[col];
    if (Array.isArray(arr)) {
      base[col] = arr.filter((p): p is string => typeof p === 'string');
    }
  }
  return base;
}

/** Keep only entries shaped { notes: string; customName?: string }. */
export function validateRepoMetadata(
  raw: unknown,
  base: AppState['repoMetadata'],
): AppState['repoMetadata'] {
  if (typeof raw !== 'object' || raw === null) return base;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null) {
      const v = value as Record<string, unknown>;
      const notes = typeof v.notes === 'string' ? v.notes : '';
      const customName =
        typeof v.customName === 'string' && v.customName.length > 0 ? v.customName : undefined;
      base[key] = customName !== undefined ? { notes, customName } : { notes };
    }
  }
  return base;
}

/**
 * Keep only entries shaped { gh: object, fetchedAt: string }. The nested gh is
 * trusted as-is (recomputed on every refresh); a malformed entry is dropped
 * rather than crashing hydration.
 */
export function validateGhCache(raw: unknown, base: AppState['ghCache']): AppState['ghCache'] {
  if (typeof raw !== 'object' || raw === null) return base;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null) {
      const entry = value as Record<string, unknown>;
      if (
        typeof entry.gh === 'object' &&
        entry.gh !== null &&
        typeof entry.fetchedAt === 'string'
      ) {
        base[key] = { gh: entry.gh as RepoGitHub, fetchedAt: entry.fetchedAt };
      }
    }
  }
  return base;
}

/** Keep only well-shaped AI cache entries; drop anything malformed. */
export function validateAiCache(raw: unknown, base: AppState['aiCache']): AppState['aiCache'] {
  if (!raw || typeof raw !== 'object') return base;
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    const e = entry as Partial<Record<string, unknown>>;
    if (
      e &&
      typeof e.summary === 'string' &&
      Array.isArray(e.tags) &&
      typeof e.inputHash === 'string' &&
      typeof e.analyzedAt === 'string'
    ) {
      base[key] = {
        summary: e.summary,
        tags: e.tags as string[],
        model: typeof e.model === 'string' ? e.model : 'unknown',
        analyzedAt: e.analyzedAt,
        inputHash: e.inputHash,
      };
    }
  }
  return base;
}

/** Typed guard for a persisted DayNote (replaces the old `any` filters). */
function isDayNote(n: unknown): n is DayNote {
  if (typeof n !== 'object' || n === null) return false;
  const d = n as Record<string, unknown>;
  const stringKeys = ['id', 'generatedAt', 'windowStart', 'windowEnd', 'body', 'model'] as const;
  if (!stringKeys.every((k) => typeof d[k] === 'string')) return false;
  if (!Array.isArray(d.repoRefs)) return false;
  return d.trigger === 'manual' || d.trigger === 'auto' || d.trigger === 'user';
}

/** Keep only well-shaped notes in the array; drop anything malformed. */
export function validateDayNotes(raw: unknown, base: AppState['dayNotes']): AppState['dayNotes'] {
  if (!raw || typeof raw !== 'object') return base;
  const dn = raw as Record<string, unknown>;
  if (Array.isArray(dn.notes)) {
    base.notes = dn.notes.filter(isDayNote);
  }
  return base;
}

/**
 * Keep only well-shaped sessions; drop anything malformed. B2 reconciliation: a
 * persisted `status:'running'` is a lie after restart (the PTY process is gone),
 * so every loaded session is forced to 'ended' — restored sessions are read-only
 * history.
 */
export function validateChatSessions(
  raw: unknown,
  base: AppState['chatSessions'],
): AppState['chatSessions'] {
  if (!raw || typeof raw !== 'object') return base;
  const cs = raw as Record<string, unknown>;
  if (Array.isArray(cs.sessions)) {
    base.sessions = cs.sessions
      .filter((s): s is Record<string, unknown> => {
        if (typeof s !== 'object' || s === null) return false;
        const r = s as Record<string, unknown>;
        return (
          typeof r.id === 'string' &&
          typeof r.repoPath === 'string' &&
          typeof r.repoName === 'string' &&
          typeof r.title === 'string' &&
          typeof r.startedAt === 'number'
        );
      })
      .map(
        (s): ChatSession => ({
          id: s.id as string,
          repoPath: s.repoPath as string,
          repoName: s.repoName as string,
          title: s.title as string,
          startedAt: s.startedAt as number,
          status: 'ended',
          exitCode: typeof s.exitCode === 'number' ? (s.exitCode as number) : null,
          // Legacy sessions (pre-shell feature) have no `kind` — default to 'claude'.
          kind: s.kind === 'shell' ? 'shell' : 'claude',
        }),
      );
  }
  return base;
}

/**
 * On-load cap for the activity log (mirrors the in-slice MAX_ACTIVITY_EVENTS).
 * Kept local rather than imported from activityLogSlice to keep this module
 * pure — that slice pulls in the store runtime (boardStoreShared), which would
 * create an import cycle (boardStoreShared → appStateValidation → slice → …).
 */
const MAX_ACTIVITY_EVENTS = 500;

/** Max persisted `label` length; longer values are treated as malformed. */
const MAX_ACTIVITY_LABEL_LEN = 200;

/**
 * Set of all valid activity kinds, asserted in-sync with the union via
 * `satisfies Set<ActivityEventKind>`: adding a member to ActivityEventKind
 * without adding it here (or vice versa) is a tsc error, so the runtime guard
 * can never silently drift from the type.
 */
const ACTIVITY_EVENT_KINDS = new Set<ActivityEventKind>([
  'ask_session_started',
  'ask_session_ended',
  'run_command_fired',
  'command_center_opened',
  'curator_run',
  'user_note_written',
  'publisher_draft_generated',
  'publisher_published',
]) satisfies Set<ActivityEventKind>;

/**
 * Typed guard for a persisted ActivityEvent. Enforces the secret-free,
 * metadata-only contract (P0 #2): `label` is the only free-text field and is
 * rejected when path-shaped (leading `/` or `\`) or longer than 200 chars, so
 * absolute filesystem paths can never survive hydration.
 */
function isValidActivityLabel(label: unknown): boolean {
  if (label === undefined) return true;
  if (typeof label !== 'string') return false;
  if (label.length > MAX_ACTIVITY_LABEL_LEN) return false;
  return !label.startsWith('/') && !label.startsWith('\\');
}

function isValidActivityTs(ts: unknown): boolean {
  return typeof ts === 'number' && Number.isFinite(ts) && ts > 0;
}

function isValidActivityKind(kind: unknown): boolean {
  return typeof kind === 'string' && ACTIVITY_EVENT_KINDS.has(kind as ActivityEventKind);
}

function isValidActivityRepoName(repoName: unknown): boolean {
  return repoName === null || typeof repoName === 'string';
}

function isActivityEvent(e: unknown): e is ActivityEvent {
  if (typeof e !== 'object' || e === null) return false;
  const r = e as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    isValidActivityTs(r.ts) &&
    isValidActivityKind(r.kind) &&
    isValidActivityRepoName(r.repoName) &&
    isValidActivityLabel(r.label)
  );
}

/**
 * Keep only well-shaped events; drop anything malformed, then cap to the newest
 * MAX_ACTIVITY_EVENTS (tail slice) on load. Returns `base` on missing/malformed
 * input so corrupt state never crashes hydration.
 */
export function validateActivityLog(
  raw: unknown,
  base: AppState['activityLog'],
): AppState['activityLog'] {
  if (!raw || typeof raw !== 'object') return base;
  const al = raw as Record<string, unknown>;
  if (Array.isArray(al.events)) {
    const events = al.events.filter(isActivityEvent);
    base.events =
      events.length > MAX_ACTIVITY_EVENTS
        ? events.slice(events.length - MAX_ACTIVITY_EVENTS)
        : events;
  }
  return base;
}

/** Per-entry variation cap; extra variations are dropped to bound disk. */
const MAX_PUBLISHER_VARIATIONS = 8;

/** Per-segment text cap; longer copy is truncated to bound disk. */
const MAX_PUBLISHER_SEGMENT_LEN = 8000;

/** Per-variation title cap; longer titles are truncated to bound disk. */
const MAX_PUBLISHER_TITLE_LEN = 300;

/**
 * repoName guard mirroring isValidActivityLabel's path defence (P0): a
 * persisted slug must be a string and must not be path-shaped (leading `/` or
 * `\`), so an absolute filesystem path can never survive hydration.
 */
function isValidPublisherRepoName(repoName: unknown): repoName is string {
  return typeof repoName === 'string' && !repoName.startsWith('/') && !repoName.startsWith('\\');
}

/**
 * Sanitise one persisted variation: keep a string|null title and an array of
 * `{ text: string }` segments, capping count and per-segment length so a hand-
 * edited file can't balloon the on-disk state. Returns null when unrecoverable.
 */
function sanitisePublisherVariation(raw: unknown): PublisherVariation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'string') return null;
  if (!(typeof v.title === 'string' || v.title === null)) return null;
  if (!Array.isArray(v.segments)) return null;
  // Cap (truncate) the title so a hand-edited file can't balloon disk via it.
  const title = typeof v.title === 'string' ? v.title.slice(0, MAX_PUBLISHER_TITLE_LEN) : v.title;
  const segments = v.segments
    .filter((seg): seg is Record<string, unknown> => typeof seg === 'object' && seg !== null)
    .filter((seg) => typeof seg.text === 'string')
    .map((seg) => ({ text: (seg.text as string).slice(0, MAX_PUBLISHER_SEGMENT_LEN) }));
  return { id: v.id, title, segments };
}

/**
 * Each of target/format/intent/model must be a member of its known Set.
 * Split out so sanitisePublisherEntry stays within the complexity budget.
 */
function hasValidPublisherEnums(e: Record<string, unknown>): boolean {
  return (
    typeof e.target === 'string' &&
    PUBLISHER_TARGETS.has(e.target as PublisherTarget) &&
    typeof e.format === 'string' &&
    POST_FORMATS.has(e.format as PostFormat) &&
    typeof e.intent === 'string' &&
    PUBLISHER_INTENTS.has(e.intent as PublisherIntent) &&
    typeof e.model === 'string' &&
    PUBLISHER_MODELS.has(e.model as PublisherModel)
  );
}

/** Validate and sanitise the roles array for a brief. */
function sanitiseBriefRoles(raw: unknown): PublisherRole[] {
  if (!Array.isArray(raw)) return ['vibe-coder'];
  const filtered = raw.filter(
    (r): r is PublisherRole => typeof r === 'string' && PUBLISHER_ROLES_SET.has(r as PublisherRole),
  );
  return filtered.length > 0 ? filtered : ['vibe-coder'];
}

/** Validate and sanitise the answers map for a brief. */
function sanitiseBriefAnswers(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const result: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (count >= MAX_PUBLISHER_ANSWERS) break;
    if (typeof v === 'string') {
      result[k] = v.slice(0, MAX_PUBLISHER_ANSWER_LEN);
      count++;
    }
  }
  return result;
}

/**
 * Sanitise a raw PublisherBrief from persisted state. Returns null only when
 * the repoName field is path-shaped (P0 guard); all other fields fall back to
 * safe defaults. Backward-compat: callers synthesize a brief when this returns
 * null (missing brief on old entries).
 */
function sanitisePublisherBrief(raw: unknown): PublisherBrief | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (!isValidPublisherRepoName(b.repoName)) return null;
  const roles = sanitiseBriefRoles(b.roles);
  const sen = b.seniority;
  const seniority: PublisherSeniority =
    typeof sen === 'string' && PUBLISHER_SENIORITIES_SET.has(sen as PublisherSeniority)
      ? (sen as PublisherSeniority)
      : 'senior';
  const aud = b.audience;
  const audience = typeof aud === 'string' ? aud.slice(0, MAX_PUBLISHER_AUDIENCE_LEN) : '';
  const int = b.intent;
  const intent: PublisherIntent =
    typeof int === 'string' && PUBLISHER_INTENTS.has(int as PublisherIntent)
      ? (int as PublisherIntent)
      : 'story';
  const guid = b.guidance;
  const guidance = typeof guid === 'string' ? guid.slice(0, MAX_PUBLISHER_ANSWER_LEN) : '';
  const answers = sanitiseBriefAnswers(b.answers);
  const repoName = b.repoName as string;
  return { roles, seniority, audience, intent, guidance, answers, repoName };
}

/** Typed guard + sanitiser for one persisted PublisherHistoryEntry. */
function sanitisePublisherEntry(raw: unknown): PublisherHistoryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== 'string') return null;
  if (!isValidPublisherRepoName(e.repoName)) return null;
  if (!hasValidPublisherEnums(e)) return null;
  if (typeof e.generatedAt !== 'string') return null;
  if (!Array.isArray(e.variations)) return null;
  const variations = e.variations
    .map(sanitisePublisherVariation)
    .filter((v): v is PublisherVariation => v !== null)
    .slice(0, MAX_PUBLISHER_VARIATIONS);
  // Backward-compat: synthesize brief from entry fields when missing/invalid.
  const brief: PublisherBrief = sanitisePublisherBrief(e.brief) ?? {
    roles: ['vibe-coder'],
    seniority: 'senior',
    audience: '',
    intent: e.intent as PublisherIntent,
    guidance: '',
    answers: {},
    repoName: e.repoName as string,
  };
  return {
    id: e.id,
    repoName: e.repoName,
    target: e.target as PublisherTarget,
    format: e.format as PostFormat,
    intent: e.intent as PublisherIntent,
    model: e.model as PublisherModel,
    generatedAt: e.generatedAt,
    variations,
    brief,
  };
}

/**
 * Keep only well-shaped entries; drop anything malformed, then cap to the newest
 * MAX_PUBLISHER_HISTORY (tail slice) on load. Each entry persists the full brief;
 * its free-text fields (audience, guidance, answers) are length-capped and the
 * `repoName` slug is path-shape-guarded on load (see sanitisePublisherBrief).
 * Returns `base` on missing/malformed input so corrupt state never crashes
 * hydration.
 */
export function validatePublisherHistory(
  raw: unknown,
  base: AppState['publisherHistory'],
): AppState['publisherHistory'] {
  if (!raw || typeof raw !== 'object') return base;
  const ph = raw as Record<string, unknown>;
  if (Array.isArray(ph.entries)) {
    const entries = ph.entries
      .map(sanitisePublisherEntry)
      .filter((e): e is PublisherHistoryEntry => e !== null);
    base.entries =
      entries.length > MAX_PUBLISHER_HISTORY
        ? entries.slice(entries.length - MAX_PUBLISHER_HISTORY)
        : entries;
  }
  return base;
}
