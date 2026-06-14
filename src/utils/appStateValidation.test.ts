import { describe, it, expect } from 'vitest';
import { createEmptyAppState } from '../types';
import {
  validateSettings,
  validateBoard,
  validateDayNotes,
  validateChatSessions,
  validateAiCache,
} from './appStateValidation';

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
});
