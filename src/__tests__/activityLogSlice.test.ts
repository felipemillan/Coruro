/**
 * Unit tests for activityLogSlice: logActivity, eventsInWindow, clearActivityLog.
 *
 * Follows the same mocking pattern as useBoardStore.userNotes.test.ts:
 * vi.hoisted invokeMock, mock @tauri-apps/plugin-fs and @tauri-apps/api/core,
 * import store after mocks.
 *
 * P0 invariants upheld:
 *   #1 (zero-network AI): no sidecar invocations asserted.
 *   #2 (secret-free): only kind/repoName/label tested; no prompt bodies stored.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ActivityEvent } from '../types';
import { MAX_ACTIVITY_EVENTS } from '../store/activityLogSlice';

// ── Hoist the invoke mock ref so the vi.mock factory can close over it ─────────
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

// ── Tauri FS mock ───────────────────────────────────────────────────────────────
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn().mockResolvedValue('{}'),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
  BaseDirectory: { Home: 'Home' },
}));

// ── Tauri invoke mock ───────────────────────────────────────────────────────────
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

// ── Utility mocks (not under test) ─────────────────────────────────────────────
vi.mock('../utils/scanner', () => ({ scanRepos: vi.fn().mockResolvedValue([]) }));
vi.mock('../utils/github', () => ({
  parseRemote: vi.fn().mockReturnValue(null),
  fetchRepoCard: vi.fn().mockResolvedValue({}),
}));

// ── Import store AFTER mocks are in place ──────────────────────────────────────
import { useBoardStore } from '../store/useBoardStore';

// ── Helpers ────────────────────────────────────────────────────────────────────
function resetStore() {
  useBoardStore.setState({
    loaded: true,
    repos: [],
    dayNotes: { notes: [] },
    activityLog: { events: [] },
  });
}

/** Build a minimal valid ActivityEvent. */
function makeEvent(overrides: Partial<ActivityEvent> & Pick<ActivityEvent, 'kind'>): ActivityEvent {
  return {
    id: overrides.id ?? 'evt-default',
    ts: overrides.ts ?? Date.now(),
    kind: overrides.kind,
    repoName: overrides.repoName ?? null,
    ...(overrides.label !== undefined ? { label: overrides.label } : {}),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  invokeMock.mockReset();
  vi.clearAllMocks();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'get_token') return Promise.resolve(null);
    return Promise.resolve('{}');
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ══════════════════════════════════════════════════════════════════════════════
// logActivity — field correctness
// ══════════════════════════════════════════════════════════════════════════════

describe('logActivity – field correctness', () => {
  it('appends an event with correct id, ts, kind, and repoName', () => {
    vi.setSystemTime(new Date('2024-03-15T10:00:00.000Z'));
    const ts = Date.now();

    const event = makeEvent({
      id: 'evt-001',
      ts,
      kind: 'ask_session_started',
      repoName: 'coruro',
    });

    useBoardStore.getState().logActivity(event);

    const events = useBoardStore.getState().activityLog.events;
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('evt-001');
    expect(events[0].ts).toBe(ts);
    expect(events[0].kind).toBe('ask_session_started');
    expect(events[0].repoName).toBe('coruro');
  });

  it('undefined label means no label key on the stored event', () => {
    const event = makeEvent({ id: 'evt-no-label', kind: 'command_center_opened', repoName: null });

    useBoardStore.getState().logActivity(event);

    const stored = useBoardStore.getState().activityLog.events[0];
    expect('label' in stored).toBe(false);
  });

  it('stores label when provided', () => {
    const event = makeEvent({
      id: 'evt-with-label',
      kind: 'curator_run',
      repoName: 'coruro',
      label: 'setup-tab',
    });

    useBoardStore.getState().logActivity(event);

    const stored = useBoardStore.getState().activityLog.events[0];
    expect(stored.label).toBe('setup-tab');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// logActivity — 500-cap
// ══════════════════════════════════════════════════════════════════════════════

describe('logActivity – 500-cap', () => {
  it('drops the oldest event when adding one beyond the cap', () => {
    // Seed exactly MAX_ACTIVITY_EVENTS events, ts 0..499
    const seed: ActivityEvent[] = Array.from({ length: MAX_ACTIVITY_EVENTS }, (_, i) => ({
      id: `seed-${i}`,
      ts: i,
      kind: 'ask_session_started' as const,
      repoName: null,
    }));
    useBoardStore.setState({ activityLog: { events: seed } });

    // Add one more event
    const newEvent = makeEvent({ id: 'new-event', ts: 9999, kind: 'run_command_fired' });
    useBoardStore.getState().logActivity(newEvent);

    const events = useBoardStore.getState().activityLog.events;

    // Still exactly 500
    expect(events).toHaveLength(MAX_ACTIVITY_EVENTS);

    // The oldest (id='seed-0', ts=0) must be gone
    expect(events.find((e) => e.id === 'seed-0')).toBeUndefined();

    // The new event is present
    expect(events.find((e) => e.id === 'new-event')).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// eventsInWindow — inclusive boundaries + empty result
// ══════════════════════════════════════════════════════════════════════════════

describe('eventsInWindow', () => {
  beforeEach(() => {
    // Seed three events at known timestamps
    const events: ActivityEvent[] = [
      {
        id: 'e1',
        ts: Date.parse('2024-03-15T08:00:00.000Z'),
        kind: 'ask_session_started',
        repoName: null,
      },
      {
        id: 'e2',
        ts: Date.parse('2024-03-15T10:00:00.000Z'),
        kind: 'command_center_opened',
        repoName: null,
      },
      {
        id: 'e3',
        ts: Date.parse('2024-03-15T12:00:00.000Z'),
        kind: 'ask_session_ended',
        repoName: 'coruro',
      },
    ];
    useBoardStore.setState({ activityLog: { events } });
  });

  it('includes events on the exact start boundary', () => {
    const result = useBoardStore
      .getState()
      .eventsInWindow('2024-03-15T08:00:00.000Z', '2024-03-15T09:00:00.000Z');

    expect(result.map((e) => e.id)).toContain('e1');
    expect(result).toHaveLength(1);
  });

  it('includes events on the exact end boundary', () => {
    const result = useBoardStore
      .getState()
      .eventsInWindow('2024-03-15T11:00:00.000Z', '2024-03-15T12:00:00.000Z');

    expect(result.map((e) => e.id)).toContain('e3');
    expect(result).toHaveLength(1);
  });

  it('includes all events within a window spanning all three', () => {
    const result = useBoardStore
      .getState()
      .eventsInWindow('2024-03-15T08:00:00.000Z', '2024-03-15T12:00:00.000Z');

    expect(result).toHaveLength(3);
    expect(result.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3']);
  });

  it('returns an empty array when no events fall in the window', () => {
    const result = useBoardStore
      .getState()
      .eventsInWindow('2024-03-15T13:00:00.000Z', '2024-03-15T14:00:00.000Z');

    expect(result).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// clearActivityLog
// ══════════════════════════════════════════════════════════════════════════════

describe('clearActivityLog', () => {
  it('empties the events array', () => {
    useBoardStore.setState({
      activityLog: {
        events: [
          makeEvent({ id: 'a', kind: 'ask_session_started' }),
          makeEvent({ id: 'b', kind: 'curator_run' }),
        ],
      },
    });

    useBoardStore.getState().clearActivityLog();

    expect(useBoardStore.getState().activityLog.events).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// multiple appends accumulate
// ══════════════════════════════════════════════════════════════════════════════

describe('multiple logActivity calls', () => {
  it('accumulates events in order', () => {
    vi.setSystemTime(new Date('2024-03-15T09:00:00.000Z'));
    const ts1 = Date.now();
    vi.setSystemTime(new Date('2024-03-15T09:01:00.000Z'));
    const ts2 = Date.now();
    vi.setSystemTime(new Date('2024-03-15T09:02:00.000Z'));
    const ts3 = Date.now();

    useBoardStore
      .getState()
      .logActivity(
        makeEvent({ id: 'first', ts: ts1, kind: 'ask_session_started', repoName: 'repo-a' }),
      );
    useBoardStore
      .getState()
      .logActivity(
        makeEvent({ id: 'second', ts: ts2, kind: 'run_command_fired', repoName: 'repo-b' }),
      );
    useBoardStore
      .getState()
      .logActivity(makeEvent({ id: 'third', ts: ts3, kind: 'user_note_written', repoName: null }));

    const events = useBoardStore.getState().activityLog.events;
    expect(events).toHaveLength(3);
    expect(events[0].id).toBe('first');
    expect(events[1].id).toBe('second');
    expect(events[2].id).toBe('third');
  });
});
