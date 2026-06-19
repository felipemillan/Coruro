// Pure helpers for the day-notes time window.
//
// generateDayNotes anchors each note on a window "since the last AI note". The
// window math is deterministic and side-effect-free, so it lives here where it
// can be reasoned about (and unit-tested) without the surrounding Tauri/IO
// machinery. Behaviour is identical to the inline logic it replaces.

import type { DayNote } from '../types';

export interface DayNotesWindow {
  /** ISO timestamp of the window start. */
  windowStart: string;
  /** ISO timestamp of the window end (== now). */
  windowEnd: string;
  /**
   * Human-readable coverage label rendered under the report H1.
   * Present when the window spans more than 24 h; null otherwise.
   * Example: "Covering activity since Jun 15, 2026"
   */
  coverageLabel: string | null;
}

/**
 * Decide whether an auto-triggered run should be skipped because the last
 * AI-generated note is still within the configured interval. Manual triggers
 * never skip. Returns true when the caller should bail out early.
 *
 * @param notes               the current day-notes list (chronological)
 * @param now                 current epoch ms
 * @param autoNotesIntervalMin configured interval (minutes; <=0 → 60)
 */
export function shouldSkipAutoRun(
  notes: DayNote[],
  now: number,
  autoNotesIntervalMin: number,
): boolean {
  // Use generatedAt for the interval check — this is the wall-clock time the
  // note was written, which determines "how long ago did we last run?".
  const lastMs = lastAiNoteGeneratedAtMs(notes);
  if (!Number.isFinite(lastMs)) return false;
  const intervalMs = (autoNotesIntervalMin > 0 ? autoNotesIntervalMin : 60) * 60 * 1000;
  return now - lastMs < intervalMs;
}

/**
 * Compute the [windowStart, windowEnd] for a day-notes run. Anchors on the last
 * AI-generated note (ignoring user-written notes) so each note covers "what
 * happened since the previous one"; clamps the start to at most 7 days back.
 *
 * When `trigger` is `'auto'`, a lower clamp of `now - 30 min` is applied so
 * that a very recent last note does not produce an absurdly short auto window.
 * Manual triggers are unclamped (the user explicitly asked for the full window).
 *
 * Anchor priority: use the previous note's windowEnd (the exact timestamp that
 * note's gathering ended), falling back to generatedAt for older notes that lack
 * it. Using generatedAt would silently drop any activity that happened between
 * windowEnd and generatedAt (i.e. the time spent running the sidecar/gather).
 *
 * @param notes    the current day-notes list (chronological)
 * @param now      current epoch ms
 * @param trigger  `'auto'` applies a 30-min lower clamp; `'manual'` unclamped
 */
export function computeWindow(
  notes: DayNote[],
  now: number,
  trigger?: 'auto' | 'manual',
): DayNotesWindow {
  const lastMs = lastAiNoteAnchorMs(notes);
  let windowStartMs = Number.isFinite(lastMs) ? lastMs : now - 86400000;
  windowStartMs = Math.max(windowStartMs, now - 7 * 86400000);
  // Lower clamp for auto runs: never let the window be shorter than 30 min.
  // This prevents a very recent last note from producing a near-empty auto window.
  // Manual runs are unclamped — the user explicitly requested the full window.
  if (trigger === 'auto') {
    windowStartMs = Math.min(windowStartMs, now - 30 * 60 * 1000);
  }
  // windowStart is the exclusive lower bound passed to git_commits_since_numstat
  // and all GitHub API calls — nothing before this timestamp is ever included.
  const durationMs = now - windowStartMs;
  const coverageLabel =
    durationMs > 86400000
      ? `Covering activity since ${new Date(windowStartMs).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}`
      : null;
  return {
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(now).toISOString(),
    coverageLabel,
  };
}

/**
 * Epoch ms of the most recent AI-generated note's generatedAt. Used by
 * shouldSkipAutoRun to measure "how long since the last run?" (wall-clock).
 * Returns NaN when no AI-generated note exists.
 */
function lastAiNoteGeneratedAtMs(notes: DayNote[]): number {
  const lastAiNote = [...notes].reverse().find((n) => n.trigger !== 'user');
  return lastAiNote ? Date.parse(lastAiNote.generatedAt) : NaN;
}

/**
 * Epoch ms of the anchor for the next window start: the most recent AI note's
 * windowEnd, falling back to generatedAt when windowEnd is absent (legacy notes).
 * Returns NaN when no AI-generated note exists.
 *
 * A hand-written ('user') note must not move the anchor — otherwise a 5pm manual
 * note would silently drop earlier activity.
 */
function lastAiNoteAnchorMs(notes: DayNote[]): number {
  const lastAiNote = [...notes].reverse().find((n) => n.trigger !== 'user');
  if (!lastAiNote) return NaN;
  // Prefer windowEnd (covers all gathered activity); fall back to generatedAt
  // for notes written before windowEnd was stored, or when windowEnd is empty
  // (legacy fixture data that pre-dates the field).
  const anchor = lastAiNote.windowEnd || lastAiNote.generatedAt;
  return Date.parse(anchor);
}
