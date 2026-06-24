/**
 * Unit tests for buildPriorContext (WI-3.2) — the prior-context extractor that
 * seeds the sidecar's continuity memory.
 *
 * P0 focus: every emitted string must have passed through sanitizeExecSummary,
 * so it carries NO numbers, paths, repo refs, commit subjects, or appEvents.
 * The extractor must tolerate BOTH layouts (post-WI-1.1 `## Executive Summary`
 * heading and legacy `**Executive Summary:**` bold) — critic F5/F9.
 */

import { describe, it, expect } from 'vitest';
import { buildPriorContext } from '../store/githubDayNotes';
import type { DayNote } from '../types';

let seq = 0;
const mkNote = (over: Partial<DayNote> = {}): DayNote => ({
  id: `note-${seq++}`,
  generatedAt: new Date().toISOString(),
  windowStart: '',
  windowEnd: '',
  body: '',
  repoRefs: [],
  model: 'apple/foundation-models',
  trigger: 'manual',
  ...over,
});

// Post-WI-1.1 layout: a standalone `## Executive Summary` heading.
const headingBody = (summary: string): string =>
  [
    '# 🗓️ Daily Session Summary',
    '',
    '## 🚦 Repository Status Breakdown',
    '- repo-a: high',
    '',
    '## Global Activity Metrics',
    '- Repos touched: 2',
    '- Files changed: 14',
    '',
    '## Executive Summary',
    '',
    summary,
    '',
    '## App Activity',
    '- Ask sessions started: 3',
  ].join('\n');

// Legacy layout: an inline `**Executive Summary:**` bold pseudo-heading.
const legacyBody = (summary: string): string =>
  [
    '# Daily Session Summary',
    '',
    '**Global Activity Metrics:** 2 repos',
    '',
    `**Executive Summary:** ${summary}`,
    '',
    '**App Activity:** 3 ask sessions',
  ].join('\n');

describe('buildPriorContext', () => {
  it('returns [] when fewer than 2 prior AI notes exist', () => {
    expect(buildPriorContext([])).toEqual([]);
    expect(buildPriorContext([mkNote({ body: headingBody('Shipped the parser.') })])).toEqual([]);
  });

  it('extracts non-empty summaries from the post-WI-1.1 heading layout', () => {
    const notes = [
      mkNote({ body: headingBody('Refactored the auth layer cleanly.') }),
      mkNote({ body: headingBody('Tightened the day-notes gate.') }),
    ];
    const ctx = buildPriorContext(notes);
    expect(ctx.length).toBe(2);
    // Newest first.
    expect(ctx[0]).toContain('Tightened the day-notes gate');
    expect(ctx[1]).toContain('Refactored the auth layer');
  });

  it('extracts non-empty summaries from the legacy bold layout', () => {
    const notes = [
      mkNote({ body: legacyBody('Promoted headings to real markdown.') }),
      mkNote({ body: legacyBody('Inverted the report layout.') }),
    ];
    const ctx = buildPriorContext(notes);
    expect(ctx.length).toBe(2);
    expect(ctx[0]).toContain('Inverted the report layout');
    expect(ctx[1]).toContain('Promoted headings to real markdown');
  });

  it('extracts from a mix of both layouts in one history', () => {
    const notes = [
      mkNote({ body: legacyBody('Old bold-form summary survives.') }),
      mkNote({ body: headingBody('New heading-form summary survives.') }),
    ];
    const ctx = buildPriorContext(notes);
    expect(ctx.length).toBe(2);
    expect(ctx.some((s) => s.includes('Old bold-form summary'))).toBe(true);
    expect(ctx.some((s) => s.includes('New heading-form summary'))).toBe(true);
  });

  it('caps at the 3 most recent AI notes', () => {
    const notes = [
      mkNote({ body: headingBody('First.') }),
      mkNote({ body: headingBody('Second.') }),
      mkNote({ body: headingBody('Third.') }),
      mkNote({ body: headingBody('Fourth.') }),
    ];
    const ctx = buildPriorContext(notes);
    expect(ctx.length).toBe(3);
    // Oldest (First.) is dropped; newest (Fourth.) is first.
    expect(ctx[0]).toContain('Fourth');
    expect(ctx.some((s) => s.includes('First'))).toBe(false);
  });

  it('strips digits from a prior summary (sanitizeExecSummary applied)', () => {
    const notes = [
      mkNote({ body: headingBody('Fixed clean things.') }),
      mkNote({ body: headingBody('Shipped 3 bug fixes across 7 files today.') }),
    ];
    const ctx = buildPriorContext(notes);
    // The digit-bearing summary must have its bare counts stripped.
    expect(ctx[0]).not.toMatch(/\b\d/);
    // Time-span leak ("today") is also stripped by the gate.
    expect(ctx[0].toLowerCase()).not.toContain('today');
  });

  it('skips notes whose model is not AI-attributed (user / local-stats / gated)', () => {
    const notes = [
      mkNote({ model: 'user', trigger: 'user', body: headingBody('Human note text.') }),
      mkNote({ model: 'local-stats', body: headingBody('Local stats note.') }),
      mkNote({ model: 'ai-gated-fallback', body: headingBody('Gated note.') }),
      mkNote({ body: headingBody('First real AI note.') }),
      mkNote({ body: headingBody('Second real AI note.') }),
    ];
    const ctx = buildPriorContext(notes);
    // Only the two genuine AI notes feed continuity.
    expect(ctx.length).toBe(2);
    expect(ctx.some((s) => s.includes('Human note'))).toBe(false);
    expect(ctx.some((s) => s.includes('Local stats'))).toBe(false);
    expect(ctx.some((s) => s.includes('Gated note'))).toBe(false);
  });

  it('drops entries that sanitize down to the local sentinel (no signal)', () => {
    const notes = [
      mkNote({ body: headingBody('123 456 789') }), // all digits → sentinel → dropped
      mkNote({ body: headingBody('Real surviving narrative.') }),
      mkNote({ body: headingBody('Another surviving narrative.') }),
    ];
    const ctx = buildPriorContext(notes);
    expect(ctx).not.toContain('Stats compiled from local git data.');
    expect(ctx.every((s) => s.length > 0)).toBe(true);
  });

  it('never leaks path / repo / commit / appEvent text into priorContext', () => {
    // A realistic composed body: the breakdown, metrics, App Activity sections all
    // contain repo names, paths, and counts. Only the Executive Summary prose must
    // survive into priorContext.
    const body = [
      '# 🗓️ Daily Session Summary',
      '',
      '## 🚦 Repository Status Breakdown',
      '### 🔴 High Activity',
      '- **coruro-secret-repo** — src/store/dayNotesSlice.ts and feat(ask): add sidebar',
      '',
      '## Global Activity Metrics',
      '- Repos touched: 2',
      '- Files changed: 14',
      '- Lines: +1,209 / -48',
      '',
      '## Executive Summary',
      '',
      'Steady momentum tidying the report path.',
      '',
      '## App Activity',
      '- Ask sessions started: 3',
      '- Run commands fired: 7',
    ].join('\n');

    const notes = [mkNote({ body }), mkNote({ body: headingBody('A second AI note narrative.') })];
    const ctx = buildPriorContext(notes);
    const joined = ctx.join('\n');

    // No repo name, no file path, no commit prefix, no App Activity, no stats.
    expect(joined).not.toContain('coruro-secret-repo');
    expect(joined).not.toContain('src/store/dayNotesSlice.ts');
    expect(joined).not.toContain('dayNotesSlice.ts');
    expect(joined).not.toContain('feat(ask)');
    expect(joined).not.toContain('Ask sessions started');
    expect(joined).not.toContain('Repos touched');
    expect(joined).not.toMatch(/\b\d/); // no bare digits anywhere
    // The real narrative is present.
    expect(joined).toContain('Steady momentum tidying the report path');
  });
});
