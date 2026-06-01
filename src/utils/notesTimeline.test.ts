import { describe, expect, test } from 'vitest';
import {
  makeNote,
  renderTimelineMarkdown,
  seedFromLegacy,
  parseTimeline,
} from './notesTimeline';
import type { NotesTimeline } from '../types';

describe('makeNote', () => {
  test('builds a note from parts', () => {
    const n = makeNote('idea', '  hi  ', 'id-1', '2026-06-01T10:00:00.000Z');
    expect(n).toEqual({
      id: 'id-1',
      type: 'idea',
      body: '  hi  ', // body stored verbatim; trimming happens at render
      createdAt: '2026-06-01T10:00:00.000Z',
    });
  });
});

describe('renderTimelineMarkdown', () => {
  test('empty timeline → placeholder', () => {
    const t: NotesTimeline = { version: 1, notes: [] };
    expect(renderTimelineMarkdown(t, 'demo')).toBe(
      '# Notes — demo\n\n_No notes yet._\n',
    );
  });

  test('renders sections oldest-first with type label + date', () => {
    const t: NotesTimeline = {
      version: 1,
      notes: [
        { id: 'a', type: 'thought', body: 'first', createdAt: '2026-06-01T10:00:00.000Z' },
        { id: 'b', type: 'bug', body: 'broke\n', createdAt: '2026-06-02T08:30:00.000Z' },
      ],
    };
    expect(renderTimelineMarkdown(t, 'demo')).toBe(
      '# Notes — demo\n\n' +
        '## 💭 Thought · 2026-06-01\n\nfirst\n\n' +
        '## 🐞 Bug · 2026-06-02\n\nbroke\n',
    );
  });
});

describe('seedFromLegacy', () => {
  test('wraps legacy markdown content in one thought note', () => {
    const t = seedFromLegacy('old notes\n', 'id-9', '2026-06-01T10:00:00.000Z');
    expect(t).toEqual({
      version: 1,
      notes: [{ id: 'id-9', type: 'thought', body: 'old notes', createdAt: '2026-06-01T10:00:00.000Z' }],
    });
  });
});

describe('parseTimeline', () => {
  test('accepts a valid v1 timeline', () => {
    const raw = '{"version":1,"notes":[]}';
    expect(parseTimeline(raw)).toEqual({ version: 1, notes: [] });
  });

  test('throws on wrong version', () => {
    expect(() => parseTimeline('{"version":2,"notes":[]}')).toThrow();
  });

  test('throws on missing notes array', () => {
    expect(() => parseTimeline('{"version":1}')).toThrow();
  });

  test('throws on invalid JSON', () => {
    expect(() => parseTimeline('not json')).toThrow();
  });
});
