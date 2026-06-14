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
  const lastMs = lastAiNoteMs(notes);
  if (!Number.isFinite(lastMs)) return false;
  const intervalMs = (autoNotesIntervalMin > 0 ? autoNotesIntervalMin : 60) * 60 * 1000;
  return now - lastMs < intervalMs;
}

/**
 * Compute the [windowStart, windowEnd] for a day-notes run. Anchors on the last
 * AI-generated note (ignoring user-written notes) so each note covers "what
 * happened since the previous one"; clamps the start to at most 7 days back. No
 * 1-hour minimum clamp is applied — a recent last note yields a short window
 * and the "no activity" path handles it.
 */
export function computeWindow(notes: DayNote[], now: number): DayNotesWindow {
  const lastMs = lastAiNoteMs(notes);
  let windowStartMs = Number.isFinite(lastMs) ? lastMs : now - 86400000;
  windowStartMs = Math.max(windowStartMs, now - 7 * 86400000);
  return {
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(now).toISOString(),
  };
}

/**
 * Epoch ms of the most recent AI-generated note's generatedAt, or NaN when no
 * such note exists. A hand-written ('user') note must not move the anchor —
 * otherwise a 5pm manual note would silently drop earlier activity.
 */
function lastAiNoteMs(notes: DayNote[]): number {
  const lastAiNote = [...notes].reverse().find((n) => n.trigger !== 'user');
  return lastAiNote ? Date.parse(lastAiNote.generatedAt) : NaN;
}
