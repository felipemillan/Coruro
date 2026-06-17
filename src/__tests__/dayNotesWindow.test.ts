/**
 * Unit tests for dayNotesWindow helpers.
 *
 * Key invariants under test:
 *  1. computeWindow anchors on the previous note's windowEnd, not generatedAt,
 *     so the gap between gather-end and note-write is never silently dropped.
 *  2. Falls back to generatedAt when windowEnd is absent (legacy notes).
 *  3. shouldSkipAutoRun uses generatedAt (interval check is wall-clock based).
 */

import { describe, it, expect } from 'vitest';
import { computeWindow, shouldSkipAutoRun } from '../store/dayNotesWindow';
import type { DayNote } from '../types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNote(overrides: Partial<DayNote>): DayNote {
  return {
    id: 'n1',
    generatedAt: new Date(Date.now() - 3600000).toISOString(),
    windowStart: new Date(Date.now() - 7200000).toISOString(),
    windowEnd: new Date(Date.now() - 3600000).toISOString(),
    body: 'x',
    repoRefs: [],
    model: 'test',
    trigger: 'manual',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// computeWindow — windowEnd anchor
// ═══════════════════════════════════════════════════════════════════════════════

describe('computeWindow — windowEnd anchor', () => {
  it('anchors windowStart on the previous note windowEnd, not generatedAt', () => {
    // Simulate a note where sidecar took 90 s: windowEnd is 90 s before generatedAt.
    const now = Date.now();
    const windowEnd = new Date(now - 2 * 3600000).toISOString(); // 2 h ago
    const generatedAt = new Date(now - 2 * 3600000 + 90000).toISOString(); // 90 s after windowEnd

    const note = makeNote({ windowEnd, generatedAt, trigger: 'auto' });
    const result = computeWindow([note], now);

    // windowStart must match windowEnd (within 1 s), not generatedAt.
    expect(Math.abs(Date.parse(result.windowStart) - Date.parse(windowEnd))).toBeLessThan(1000);
    // Explicitly must NOT equal generatedAt.
    expect(Math.abs(Date.parse(result.windowStart) - Date.parse(generatedAt))).toBeGreaterThan(
      80000,
    );
  });

  it('falls back to generatedAt when windowEnd is missing (legacy note)', () => {
    const now = Date.now();
    const generatedAt = new Date(now - 2 * 3600000).toISOString();

    // Simulate a legacy note: omit windowEnd by casting.
    const legacyNote = makeNote({ generatedAt, trigger: 'manual' }) as Omit<DayNote, 'windowEnd'> &
      Partial<Pick<DayNote, 'windowEnd'>>;
    delete legacyNote.windowEnd;

    const result = computeWindow([legacyNote as DayNote], now);

    expect(Math.abs(Date.parse(result.windowStart) - Date.parse(generatedAt))).toBeLessThan(1000);
  });

  it('ignores user-written notes when computing the anchor', () => {
    const now = Date.now();
    const aiWindowEnd = new Date(now - 4 * 3600000).toISOString();
    const userNoteAt = new Date(now - 1 * 3600000).toISOString();

    const aiNote = makeNote({ windowEnd: aiWindowEnd, generatedAt: aiWindowEnd, trigger: 'auto' });
    const userNote = makeNote({
      windowEnd: userNoteAt,
      generatedAt: userNoteAt,
      trigger: 'user',
    });
    // user note is more recent but must be ignored
    const result = computeWindow([aiNote, userNote], now);

    expect(Math.abs(Date.parse(result.windowStart) - Date.parse(aiWindowEnd))).toBeLessThan(1000);
  });

  it('defaults to 24 h back when there are no prior AI notes', () => {
    const now = Date.now();
    const result = computeWindow([], now);

    const expectedMs = now - 86400000;
    expect(Math.abs(Date.parse(result.windowStart) - expectedMs)).toBeLessThan(1000);
  });

  it('clamps the start to at most 7 days back', () => {
    const now = Date.now();
    // Provide a note with windowEnd 10 days ago — should be clamped to 7 days.
    const ancientWindowEnd = new Date(now - 10 * 86400000).toISOString();
    const note = makeNote({ windowEnd: ancientWindowEnd, generatedAt: ancientWindowEnd });
    const result = computeWindow([note], now);

    const sevenDaysAgoMs = now - 7 * 86400000;
    expect(Math.abs(Date.parse(result.windowStart) - sevenDaysAgoMs)).toBeLessThan(1000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// shouldSkipAutoRun
// ═══════════════════════════════════════════════════════════════════════════════

describe('shouldSkipAutoRun', () => {
  it('returns true when the last AI note was generated within the interval', () => {
    const now = Date.now();
    const recentNote = makeNote({
      generatedAt: new Date(now - 30 * 60 * 1000).toISOString(), // 30 min ago
      trigger: 'auto',
    });
    expect(shouldSkipAutoRun([recentNote], now, 60)).toBe(true);
  });

  it('returns false when the last AI note is older than the interval', () => {
    const now = Date.now();
    const oldNote = makeNote({
      generatedAt: new Date(now - 90 * 60 * 1000).toISOString(), // 90 min ago
      trigger: 'auto',
    });
    expect(shouldSkipAutoRun([oldNote], now, 60)).toBe(false);
  });

  it('returns false when there are no prior notes', () => {
    expect(shouldSkipAutoRun([], Date.now(), 60)).toBe(false);
  });
});
