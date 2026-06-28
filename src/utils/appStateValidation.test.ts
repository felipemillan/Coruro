import { describe, it, expect } from 'vitest';
import { createEmptyAppState } from '../types';
import {
  validateSettings,
  validateBoard,
  validateDayNotes,
  validateChatSessions,
  validateAiCache,
  validatePublisherHistory,
} from './appStateValidation';

/** A minimal, well-shaped persisted Publisher entry for history tests. */
function makePublisherEntry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'e1',
    repoName: 'my-repo',
    target: 'linkedin',
    format: 'single',
    intent: 'story',
    model: 'claude-sonnet-4-6',
    generatedAt: '2026-01-01T00:00:00.000Z',
    variations: [{ id: 'v1', title: 'Hello', segments: [{ text: 'body' }] }],
    ...over,
  };
}

describe('appStateValidation', () => {
  it('returns the default slice for non-object input', () => {
    const settings = validateSettings(42, createEmptyAppState().settings);
    expect(settings.rootDirectory).toBe(createEmptyAppState().settings.rootDirectory);
  });

  it('keeps valid settings and rejects wrong types / out-of-range numbers', () => {
    const s = validateSettings(
      { rootDirectory: '/x', hasToken: true, refreshIntervalMin: -5 },
      createEmptyAppState().settings,
    );
    expect(s.rootDirectory).toBe('/x');
    expect(s.hasToken).toBe(true);
    // -5 is rejected (must be >= 0) → default retained.
    expect(s.refreshIntervalMin).toBe(createEmptyAppState().settings.refreshIntervalMin);
  });

  it('filters non-string entries out of a board column', () => {
    const b = validateBoard({ inbox: ['a', 2, null, 'b'] }, createEmptyAppState().board);
    expect(b.inbox).toEqual(['a', 'b']);
  });

  it('drops malformed day notes, keeps well-shaped ones', () => {
    const valid = {
      id: '1',
      generatedAt: 'x',
      windowStart: 'x',
      windowEnd: 'x',
      body: 'b',
      repoRefs: [],
      model: 'm',
      trigger: 'auto',
    };
    const dn = validateDayNotes(
      { notes: [valid, { id: 5 }, null] },
      createEmptyAppState().dayNotes,
    );
    expect(dn.notes).toHaveLength(1);
    expect(dn.notes[0].id).toBe('1');
  });

  it('reconciles a persisted running session to ended', () => {
    const cs = validateChatSessions(
      {
        sessions: [
          { id: '1', repoPath: '/p', repoName: 'n', title: 't', startedAt: 1, status: 'running' },
        ],
      },
      createEmptyAppState().chatSessions,
    );
    expect(cs.sessions).toHaveLength(1);
    expect(cs.sessions[0].status).toBe('ended');
  });

  it('drops malformed ai cache entries', () => {
    const ai = validateAiCache(
      {
        good: { summary: 's', tags: [], inputHash: 'h', analyzedAt: 'a' },
        bad: { summary: 5 },
      },
      createEmptyAppState().aiCache,
    );
    expect(Object.keys(ai)).toEqual(['good']);
  });

  it('keeps the newest entries when over the 200-entry cap (tail slice)', () => {
    const entries = Array.from({ length: 205 }, (_, i) =>
      makePublisherEntry({ id: `e${i}`, generatedAt: `2026-01-01T00:00:${i}.000Z` }),
    );
    const ph = validatePublisherHistory({ entries }, createEmptyAppState().publisherHistory);
    expect(ph.entries).toHaveLength(200);
    // Tail slice → oldest 5 dropped, newest (e204) retained.
    expect(ph.entries[0].id).toBe('e5');
    expect(ph.entries[199].id).toBe('e204');
  });

  it('drops an entry whose repoName is path-shaped (P0 no raw paths)', () => {
    const ph = validatePublisherHistory(
      {
        entries: [
          makePublisherEntry({ id: 'ok' }),
          makePublisherEntry({ id: 'absolute', repoName: '/Users/x/secret' }),
          makePublisherEntry({ id: 'win', repoName: '\\\\server\\share' }),
        ],
      },
      createEmptyAppState().publisherHistory,
    );
    expect(ph.entries.map((e) => e.id)).toEqual(['ok']);
  });

  it('truncates segment text, title, and caps variation count', () => {
    const ph = validatePublisherHistory(
      {
        entries: [
          makePublisherEntry({
            variations: Array.from({ length: 12 }, (_, i) => ({
              id: `v${i}`,
              title: 'T'.repeat(500),
              segments: [{ text: 'x'.repeat(9000) }],
            })),
          }),
        ],
      },
      createEmptyAppState().publisherHistory,
    );
    const v = ph.entries[0].variations;
    expect(v).toHaveLength(8); // MAX_PUBLISHER_VARIATIONS
    expect(v[0].title).toHaveLength(300); // MAX_PUBLISHER_TITLE_LEN
    expect(v[0].segments[0].text).toHaveLength(8000); // MAX_PUBLISHER_SEGMENT_LEN
  });

  it('drops malformed entries without throwing, keeps well-shaped ones', () => {
    const ph = validatePublisherHistory(
      {
        entries: [
          makePublisherEntry({ id: 'good' }),
          null,
          { id: 5 },
          makePublisherEntry({ id: 'badTarget', target: 'myspace' }),
          makePublisherEntry({ id: 'noVariations', variations: 'nope' }),
        ],
      },
      createEmptyAppState().publisherHistory,
    );
    expect(ph.entries.map((e) => e.id)).toEqual(['good']);
  });

  it('returns the default publisher-history slice for non-object input', () => {
    const base = createEmptyAppState().publisherHistory;
    expect(validatePublisherHistory(42, base)).toBe(base);
  });
});
