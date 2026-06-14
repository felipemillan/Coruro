/**
 * Unit tests for appStateValidation — validateActivityLog and the compile-time
 * secret-free keyof assertion.
 *
 * Follows the same style as sessionReport.test.ts: vitest imports, pure
 * function tests, no Tauri mocks required (validator has no runtime deps).
 */

import { describe, it, expect } from 'vitest';
import type { AppState, ActivityEvent } from '../types';
import { validateActivityLog } from '../utils/appStateValidation';

// ── Compile-time secret-free assertion ──────────────────────────────────────
// If a forbidden field (prompt/body/transcript/content/token/message/secret
// etc.) is ever added to ActivityEvent, this type narrows to `never` and tsc
// fails on the assignment below — no runtime test needed.
type _Fields = keyof ActivityEvent extends 'id' | 'ts' | 'kind' | 'repoName' | 'label'
  ? true
  : never;
const _x: _Fields = true;

// Silence the "unused variable" linter for the assertion above.
void _x;

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE: AppState['activityLog'] = { events: [] };

/** Return a fresh copy of the base to avoid cross-test mutation. */
const base = (): AppState['activityLog'] => ({ events: [] });

/** Minimal valid ActivityEvent fixture — override individual fields as needed. */
const makeEvent = (over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: 'e1',
  ts: 1_000_000,
  kind: 'ask_session_started',
  repoName: 'myapp',
  ...over,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('validateActivityLog', () => {
  it('returns base when activityLog field is missing (undefined)', () => {
    const result = validateActivityLog(undefined, base());
    expect(result).toEqual(BASE);
  });

  it('returns base when activityLog field is null', () => {
    const result = validateActivityLog(null, base());
    expect(result).toEqual(BASE);
  });

  it('returns base when activityLog field is a non-object primitive', () => {
    const result = validateActivityLog('not-an-object', base());
    expect(result).toEqual(BASE);
  });

  it('returns base unchanged when events array is absent', () => {
    const result = validateActivityLog({}, base());
    // No `events` key → base.events stays []
    expect(result.events).toEqual([]);
  });

  it('keeps a fully valid event unchanged', () => {
    const ev = makeEvent();
    const result = validateActivityLog({ events: [ev] }, base());
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual(ev);
  });

  it('drops events with an unknown kind', () => {
    const bad = makeEvent({ kind: 'unknown_event' as ActivityEvent['kind'] });
    const good = makeEvent({ id: 'e2', kind: 'curator_run' });
    const result = validateActivityLog({ events: [bad, good] }, base());
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('e2');
  });

  it('drops events with a non-finite ts (NaN)', () => {
    const bad = makeEvent({ ts: NaN });
    const result = validateActivityLog({ events: [bad] }, base());
    expect(result.events).toHaveLength(0);
  });

  it('drops events with a non-finite ts (Infinity)', () => {
    const bad = makeEvent({ ts: Infinity });
    const result = validateActivityLog({ events: [bad] }, base());
    expect(result.events).toHaveLength(0);
  });

  it('drops events with a negative ts', () => {
    const bad = makeEvent({ ts: -1 });
    const result = validateActivityLog({ events: [bad] }, base());
    expect(result.events).toHaveLength(0);
  });

  it('drops events with ts === 0 (non-positive)', () => {
    const bad = makeEvent({ ts: 0 });
    const result = validateActivityLog({ events: [bad] }, base());
    expect(result.events).toHaveLength(0);
  });

  it('drops events with a missing id', () => {
    const bad = { ts: 1_000_000, kind: 'curator_run', repoName: null } as unknown as ActivityEvent;
    const result = validateActivityLog({ events: [bad] }, base());
    expect(result.events).toHaveLength(0);
  });

  it('drops events with a non-string id', () => {
    const bad = makeEvent({ id: 42 as unknown as string });
    const result = validateActivityLog({ events: [bad] }, base());
    expect(result.events).toHaveLength(0);
  });

  it('drops events whose label starts with "/"', () => {
    const bad = makeEvent({ label: '/absolute/path/to/file' });
    const result = validateActivityLog({ events: [bad] }, base());
    expect(result.events).toHaveLength(0);
  });

  it('drops events whose label starts with "\\"', () => {
    const bad = makeEvent({ label: '\\Windows\\System32\\secret' });
    const result = validateActivityLog({ events: [bad] }, base());
    expect(result.events).toHaveLength(0);
  });

  it('drops events whose label exceeds 200 characters', () => {
    const bad = makeEvent({ label: 'x'.repeat(201) });
    const result = validateActivityLog({ events: [bad] }, base());
    expect(result.events).toHaveLength(0);
  });

  it('keeps events whose label is exactly 200 characters', () => {
    const good = makeEvent({ label: 'a'.repeat(200) });
    const result = validateActivityLog({ events: [good] }, base());
    expect(result.events).toHaveLength(1);
  });

  it('keeps events where repoName is null', () => {
    const ev = makeEvent({ repoName: null });
    const result = validateActivityLog({ events: [ev] }, base());
    expect(result.events).toHaveLength(1);
    expect(result.events[0].repoName).toBeNull();
  });

  it('keeps events where label is absent (optional field)', () => {
    const ev = makeEvent();
    // Ensure label is not set on the fixture (makeEvent doesn't set it by default)
    expect('label' in ev).toBe(false);
    const result = validateActivityLog({ events: [ev] }, base());
    expect(result.events).toHaveLength(1);
  });

  it('keeps a valid event with an empty string label', () => {
    const ev = makeEvent({ label: '' });
    const result = validateActivityLog({ events: [ev] }, base());
    expect(result.events).toHaveLength(1);
  });

  it('caps 501 events to the newest 500 (tail slice)', () => {
    const events: ActivityEvent[] = Array.from({ length: 501 }, (_, i) =>
      makeEvent({ id: `e${i}`, ts: 1_000_000 + i }),
    );
    const result = validateActivityLog({ events }, base());
    expect(result.events).toHaveLength(500);
    // Should keep the last 500 (ids e1..e500), dropping e0 (the oldest)
    expect(result.events[0].id).toBe('e1');
    expect(result.events[499].id).toBe('e500');
  });

  it('does not cap when events is exactly 500', () => {
    const events: ActivityEvent[] = Array.from({ length: 500 }, (_, i) =>
      makeEvent({ id: `e${i}`, ts: 1_000_000 + i }),
    );
    const result = validateActivityLog({ events }, base());
    expect(result.events).toHaveLength(500);
  });

  it('mixes valid and invalid events — keeps only valid ones', () => {
    const events = [
      makeEvent({ id: 'ok1' }),
      makeEvent({ id: 'bad-kind', kind: 'bogus' as ActivityEvent['kind'] }),
      makeEvent({ id: 'ok2', kind: 'command_center_opened', repoName: null }),
      makeEvent({ id: 'bad-ts', ts: -5 }),
      makeEvent({ id: 'bad-label', label: '/secret/path' }),
    ];
    const result = validateActivityLog({ events }, base());
    const ids = result.events.map((e) => e.id);
    expect(ids).toEqual(['ok1', 'ok2']);
  });

  it('keeps events for all valid ActivityEventKind values', () => {
    const kinds: ActivityEvent['kind'][] = [
      'ask_session_started',
      'ask_session_ended',
      'run_command_fired',
      'command_center_opened',
      'curator_run',
      'user_note_written',
    ];
    const events = kinds.map((kind, i) => makeEvent({ id: `e${i}`, kind }));
    const result = validateActivityLog({ events }, base());
    expect(result.events).toHaveLength(kinds.length);
  });
});
