/**
 * Unit tests for useBoardStore — generateDayNotes + setupAutoNotesTimer.
 *
 * Strategy: mock all external I/O (Tauri invoke, fetch, Tauri FS) so the
 * store logic runs in Node without a real Tauri runtime or network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Repo } from '../types';

// ── Hoist the invoke mock ref so the vi.mock factory can close over it ───────
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

// ── Tauri FS mock ─────────────────────────────────────────────────────────────
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn().mockResolvedValue('{}'),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
  BaseDirectory: { Home: 'Home' },
}));

// ── Tauri invoke mock ─────────────────────────────────────────────────────────
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

// ── Utility mocks (used by scanAndDistribute etc, not under test) ─────────────
vi.mock('../utils/scanner', () => ({ scanRepos: vi.fn().mockResolvedValue([]) }));
vi.mock('../utils/github', () => ({
  parseRemote: vi.fn().mockReturnValue(null),
  fetchRepoCard: vi.fn().mockResolvedValue({}),
}));
vi.mock('../utils/notesFile', () => ({
  readRepoNotes: vi.fn().mockResolvedValue(null),
  writeRepoNotes: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/aiContext', () => ({
  buildAiContext: vi.fn().mockResolvedValue({}),
  inputHash: vi.fn().mockReturnValue('hash'),
  capItemsToContextBudget: <T>(items: T[]) => items,
}));

// ── Import store AFTER mocks are in place ─────────────────────────────────────
import { useBoardStore } from '../store/useBoardStore';

// ── CommitDetail fixture (shape returned by git_commits_since_numstat) ───────
const makeCommit = (sha: string, subject: string) => ({
  sha,
  subject,
  files: ['src/a.ts'],
  folders: ['src'],
  added: 1,
  deleted: 0,
});

// ── Minimal valid Repo fixture ────────────────────────────────────────────────
const makeRepo = (name: string, path: string): Repo => ({
  name,
  path,
  branch: 'main',
  dirty: false,
  prCount: 0,
  remoteUrl: null,
  gh: null,
  aiSummary: null,
  aiTags: null,
  ahead: null,
  behind: null,
  commitCount: 0,
  lastCommitAt: null,
  branchCount: 0,
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function resetStore() {
  useBoardStore.setState({
    loaded: true,
    generatingNotes: false,
    notesError: null,
    repos: [],
    // Seed an empty activity log so app-activity state never leaks between
    // tests — a stray in-window event would defeat the empty-window early
    // returns ("returns early when empty" / "silent auto on quiet window").
    activityLog: { events: [] },
  });
}

beforeEach(() => {
  resetStore();
  invokeMock.mockReset();
  vi.clearAllMocks();
  // Default: get_token returns null (no token), git_dirty_stat returns ''
  // (clean repo — a truthy default like '{}' would inject bogus
  // '[uncommitted] {}' context lines), everything else returns '{}'.
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'get_token') return Promise.resolve(null);
    if (cmd === 'git_dirty_stat') return Promise.resolve('');
    return Promise.resolve('{}');
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════════════
// generateDayNotes
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateDayNotes', () => {
  it('returns early when generatingNotes is already true', async () => {
    useBoardStore.setState({ generatingNotes: true });

    await useBoardStore.getState().generateDayNotes('manual');

    // ai_day_notes must not have been invoked
    expect(invokeMock).not.toHaveBeenCalledWith('ai_day_notes', expect.anything());
  });

  it('sets notesError and returns early when activeRepoData is empty', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_token') return Promise.resolve(null);
      if (cmd === 'git_dirty_stat') return Promise.resolve(''); // clean repo by default
      if (cmd === 'git_commits_since_numstat') return Promise.resolve([]);
      return Promise.resolve('{}');
    });

    await useBoardStore.getState().generateDayNotes('manual');

    expect(useBoardStore.getState().notesError).toBe('No activity found since the last note.');
  });

  it('surfaces a visible "nothing new" message on auto run with no activity', async () => {
    // Auto trigger must now set notesError (not stay null) so the user sees
    // that the window was checked and came up empty — the message auto-dismisses
    // after 5 s via a setTimeout, but we only verify the immediate state here.
    vi.useFakeTimers();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_token') return Promise.resolve(null);
      if (cmd === 'git_dirty_stat') return Promise.resolve('');
      if (cmd === 'git_commits_since_numstat') return Promise.resolve([]);
      return Promise.resolve('{}');
    });

    await useBoardStore.getState().generateDayNotes('auto');

    // Immediately after the run: "nothing new" message is visible.
    expect(useBoardStore.getState().notesError).toBe('No activity found since the last note.');
    expect(invokeMock).not.toHaveBeenCalledWith('ai_day_notes', expect.anything());

    // After the 5 s auto-dismiss fires, the message is cleared.
    await vi.advanceTimersByTimeAsync(5001);
    expect(useBoardStore.getState().notesError).toBeNull();
  });

  it('stays silent (no error) when an auto run finds no activity [legacy — superseded above]', async () => {
    // This test is kept as documentation that the *old* behaviour was null.
    // The new behaviour (above) sets a brief visible message that auto-dismisses.
    // Skipped so it does not contradict the new implementation.
    // (Remove this block in a future cleanup pass.)
  });

  it('produces an app-only local-stats note without invoking the sidecar', async () => {
    // No repos, but one in-window activity event. The app-only path must emit a
    // deterministic stats-only note and must NEVER call ai_day_notes (P0 #1:
    // the on-device model is never invoked with empty repo data).
    useBoardStore.setState({
      repos: [],
      activityLog: {
        events: [
          {
            id: 'evt-1',
            ts: Date.now(),
            kind: 'ask_session_started' as const,
            repoName: 'fake-repo',
          },
        ],
      },
    });

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_token') return Promise.resolve(null);
      if (cmd === 'git_dirty_stat') return Promise.resolve('');
      if (cmd === 'git_commits_since_numstat') return Promise.resolve([]);
      return Promise.resolve('{}');
    });

    await useBoardStore.getState().generateDayNotes('manual');

    const { notesError, dayNotes } = useBoardStore.getState();
    expect(notesError).toBeNull();
    // Exactly one note was produced.
    expect(dayNotes.notes).toHaveLength(1);
    const note = dayNotes.notes[0];
    expect(note.model).toBe('local-stats');
    expect(note.body).toContain('App Activity');
    // Zero-network AI: the sidecar must not have been touched on the app-only path.
    expect(invokeMock).not.toHaveBeenCalledWith('ai_day_notes', expect.anything());
  });

  it('anchors the window at the last note generatedAt (session anchoring)', async () => {
    const lastGeneratedAt = new Date(Date.now() - 2 * 3600000).toISOString(); // 2h ago
    useBoardStore.setState({
      repos: [makeRepo('fake-repo', '/fake/repo')],
      dayNotes: {
        notes: [
          {
            id: 'prev',
            generatedAt: lastGeneratedAt,
            windowStart: '',
            windowEnd: '',
            body: 'x',
            repoRefs: [],
            model: 'test',
            trigger: 'manual' as const,
          },
        ],
      },
    });

    let sinceIso = '';
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'get_token') return Promise.resolve(null);
      if (cmd === 'git_dirty_stat') return Promise.resolve(''); // clean repo by default
      if (cmd === 'git_commits_since_numstat') {
        sinceIso = String(args?.sinceIso ?? '');
        return Promise.resolve([makeCommit('ddd444', 'feat: anchored')]);
      }
      if (cmd === 'ai_day_notes')
        return Promise.resolve(JSON.stringify({ ok: true, body: 'TLDR; ok', model: 'test' }));
      return Promise.resolve('{}');
    });

    await useBoardStore.getState().generateDayNotes('manual');

    // Window start should equal the previous note's timestamp (2h ago is
    // within the [1h, 7d] clamp, so it passes through unchanged).
    expect(Math.abs(Date.parse(sinceIso) - Date.parse(lastGeneratedAt))).toBeLessThan(1000);
  });

  it('anchors the window at the last note windowEnd, not generatedAt', async () => {
    // The sidecar may take 90 s after windowEnd — that gap must not be dropped.
    // windowEnd (gather-end) is the correct anchor; generatedAt is ~90 s later.
    const now = Date.now();
    const lastWindowEnd = new Date(now - 2 * 3600000).toISOString(); // 2h ago
    const lastGeneratedAt = new Date(now - 2 * 3600000 + 90000).toISOString(); // 90s after windowEnd

    useBoardStore.setState({
      repos: [makeRepo('fake-repo', '/fake/repo')],
      dayNotes: {
        notes: [
          {
            id: 'prev',
            generatedAt: lastGeneratedAt,
            windowStart: new Date(now - 5 * 3600000).toISOString(),
            windowEnd: lastWindowEnd,
            body: 'x',
            repoRefs: [],
            model: 'test',
            trigger: 'auto' as const,
          },
        ],
      },
    });

    let sinceIso = '';
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'get_token') return Promise.resolve(null);
      if (cmd === 'git_dirty_stat') return Promise.resolve('');
      if (cmd === 'git_commits_since_numstat') {
        sinceIso = String(args?.sinceIso ?? '');
        return Promise.resolve([makeCommit('eee555', 'feat: windowEnd anchor test')]);
      }
      if (cmd === 'ai_day_notes')
        return Promise.resolve(JSON.stringify({ ok: true, body: 'TLDR; ok', model: 'test' }));
      return Promise.resolve('{}');
    });

    await useBoardStore.getState().generateDayNotes('manual');

    // sinceIso must match windowEnd (the gather end), not generatedAt (+90 s).
    expect(Math.abs(Date.parse(sinceIso) - Date.parse(lastWindowEnd))).toBeLessThan(1000);
    // Must differ from generatedAt by roughly 90 s (not equal).
    expect(Math.abs(Date.parse(sinceIso) - Date.parse(lastGeneratedAt))).toBeGreaterThan(80000);
  });

  it('resets generatingNotes to false on empty-repo early return (finally block)', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_token') return Promise.resolve(null);
      if (cmd === 'git_dirty_stat') return Promise.resolve(''); // clean repo by default
      if (cmd === 'git_commits_since_numstat') return Promise.resolve([]);
      return Promise.resolve('{}');
    });

    await useBoardStore.getState().generateDayNotes('manual');

    expect(useBoardStore.getState().generatingNotes).toBe(false);
  });

  it('degrades to a stats-only note (no error) on sidecar ok:false response', async () => {
    // Two repos so the sidecar is actually invoked (WI-1.6 skips it on a lone
    // repo); this test exercises the ok:false degradation path specifically.
    useBoardStore.setState({
      repos: [makeRepo('fake-repo', '/fake/repo'), makeRepo('second-repo', '/second/repo')],
    });

    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      const path = (args as { path?: string } | undefined)?.path;
      if (cmd === 'get_token') return Promise.resolve(null);
      // fake-repo carries the commit; second-repo is dirty so both stay active
      // (≥2 repos) and the sidecar is actually invoked to exercise ok:false.
      if (cmd === 'git_dirty_stat')
        return Promise.resolve(path === '/second/repo' ? '1 file changed, 1 insertion(+)' : '');
      if (cmd === 'git_commits_since_numstat')
        return Promise.resolve(
          path === '/fake/repo' ? [makeCommit('aaa111', 'fix: something')] : [],
        );
      if (cmd === 'ai_day_notes')
        return Promise.resolve(JSON.stringify({ ok: false, error: 'generation' }));
      return Promise.resolve('{}');
    });

    await useBoardStore.getState().generateDayNotes('manual');

    // The report skeleton is deterministic — AI failure must not block the note.
    const { notesError, dayNotes } = useBoardStore.getState();
    expect(notesError).toBeNull();
    const note = dayNotes.notes[dayNotes.notes.length - 1];
    expect(note.model).toBe('local-stats');
    expect(note.body).toContain('Daily Session Summary');
    // WI-1.5: neutral fallback copy (no product-name "summary unavailable").
    expect(note.body).toContain('Stats compiled from local git data.');
  });

  it('resets generatingNotes to false when sidecar invoke throws (finally block)', async () => {
    useBoardStore.setState({ repos: [makeRepo('fake-repo', '/fake/repo')] });

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_token') return Promise.resolve(null);
      if (cmd === 'git_dirty_stat') return Promise.resolve(''); // clean repo by default
      if (cmd === 'git_commits_since_numstat')
        return Promise.resolve([makeCommit('bbb222', 'chore: bump deps')]);
      if (cmd === 'ai_day_notes') return Promise.reject(new Error('spawn error'));
      return Promise.resolve('{}');
    });

    await useBoardStore.getState().generateDayNotes('auto');

    expect(useBoardStore.getState().generatingNotes).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// setupAutoNotesTimer
// ═══════════════════════════════════════════════════════════════════════════════

describe('setupAutoNotesTimer', () => {
  it('does NOT start a timer when autoNotesEnabled is false', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    useBoardStore.setState({
      settings: {
        ...useBoardStore.getState().settings,
        autoNotesEnabled: false,
        autoNotesIntervalMin: 60,
      },
    });

    useBoardStore.getState().setupAutoNotesTimer();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('clears an existing timer before registering a new one', () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    useBoardStore.setState({
      settings: {
        ...useBoardStore.getState().settings,
        autoNotesEnabled: true,
        autoNotesIntervalMin: 60,
      },
    });

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_token') return Promise.resolve(null);
      if (cmd === 'git_dirty_stat') return Promise.resolve(''); // clean repo by default
      if (cmd === 'git_commits_since_numstat') return Promise.resolve([]);
      return Promise.resolve('{}');
    });

    // First call registers a timer; second call must clear it first
    useBoardStore.getState().setupAutoNotesTimer();
    useBoardStore.getState().setupAutoNotesTimer();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it('calls generateDayNotes("auto") immediately when autoNotesEnabled is true', async () => {
    vi.useFakeTimers();

    useBoardStore.setState({
      repos: [makeRepo('fake-repo', '/fake/repo')],
      settings: {
        ...useBoardStore.getState().settings,
        autoNotesEnabled: true,
        autoNotesIntervalMin: 60,
      },
    });

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_token') return Promise.resolve(null);
      if (cmd === 'git_dirty_stat') return Promise.resolve(''); // clean repo by default
      if (cmd === 'git_commits_since_numstat')
        return Promise.resolve([makeCommit('ccc333', 'feat: add feature')]);
      if (cmd === 'ai_day_notes')
        return Promise.resolve(
          JSON.stringify({ ok: true, body: 'Worked on @fake-repo.', model: 'test' }),
        );
      return Promise.resolve('{}');
    });

    useBoardStore.getState().setupAutoNotesTimer();

    // Flush only the microtask queue + zero-delay macrotasks so the immediate
    // generateDayNotes('auto') call settles without running the setInterval
    // to completion (which would cause an infinite-loop abort).
    await vi.advanceTimersByTimeAsync(0);

    // After the immediate call settles, generatingNotes should be false
    expect(useBoardStore.getState().generatingNotes).toBe(false);
  });
});
