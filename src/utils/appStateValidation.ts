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
  COLUMN_IDS,
} from '../types';

type Settings = AppState['settings'];

/** rootDirectory accepts any string; the rest must be non-empty. */
function applyStringSettings(s: Record<string, unknown>, base: Settings): void {
  if (typeof s.rootDirectory === 'string') base.rootDirectory = s.rootDirectory;
  for (const k of ['editorCommand', 'editorApp', 'terminalApp'] as const) {
    const v = s[k];
    if (typeof v === 'string' && v.length > 0) base[k] = v;
  }
}

function applyBooleanSettings(s: Record<string, unknown>, base: Settings): void {
  for (const k of ['hasToken', 'debugBannerEnabled', 'autoNotesEnabled'] as const) {
    if (typeof s[k] === 'boolean') base[k] = s[k] as boolean;
  }
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

/** Keep only entries shaped { notes: string }. */
export function validateRepoMetadata(
  raw: unknown,
  base: AppState['repoMetadata'],
): AppState['repoMetadata'] {
  if (typeof raw !== 'object' || raw === null) return base;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null) {
      const notes = (value as Record<string, unknown>).notes;
      base[key] = { notes: typeof notes === 'string' ? notes : '' };
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
        }),
      );
  }
  return base;
}
