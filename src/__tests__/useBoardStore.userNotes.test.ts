/**
 * Unit tests for useBoardStore — addUserNote, updateDayNote,
 * and generateDayNotes integration with git_dirty_stat.
 *
 * Follows the same mocking pattern as useBoardStore.generateDayNotes.test.ts:
 * vi.hoisted invokeMock, mock @tauri-apps/plugin-fs and @tauri-apps/api/core,
 * import store after mocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DayNote, Repo } from '../types';

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

// ── Utility mocks (used by scanAndDistribute etc, not under test) ───────────────
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

// ── Import store AFTER mocks are in place ──────────────────────────────────────
import { useBoardStore } from '../store/useBoardStore';

// ── Minimal valid Repo fixture ─────────────────────────────────────────────────
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

// ── CommitDetail fixture ───────────────────────────────────────────────────────
const makeCommit = (sha: string, subject: string) => ({
  sha,
  subject,
  files: ['src/a.ts'],
  folders: ['src'],
  added: 1,
  deleted: 0,
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function resetStore() {
  useBoardStore.setState({
    loaded: true,
    generatingNotes: false,
    notesError: null,
    repos: [],
    dayNotes: { notes: [] },
  });
}

beforeEach(() => {
  resetStore();
  invokeMock.mockReset();
  vi.clearAllMocks();
  // Default: get_token null, git_dirty_stat clean (''), everything else '{}'.
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'get_token') return Promise.resolve(null);
    if (cmd === 'git_dirty_stat') return Promise.resolve('');
    return Promise.resolve('{}');
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ══════════════════════════════════════════════════════════════════════════════
// addUserNote
// ══════════════════════════════════════════════════════════════════════════════

describe('addUserNote', () => {
  it('creates a note with trigger "user" and model "user"', () => {
    useBoardStore.getState().addUserNote('Finished the landing page layout.');

    const notes = useBoardStore.getState().dayNotes.notes;
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note.trigger).toBe('user');
    expect(note.model).toBe('user');
  });

  it('preserves the body exactly as provided', () => {
    const body = 'Refactored the auth module and cleaned up tests.';
    useBoardStore.getState().addUserNote(body);

    const note = useBoardStore.getState().dayNotes.notes[0];
    expect(note.body).toBe(body);
  });

  it('extracts @mention repo refs from the body', () => {
    // Set up a repo named 'fake-repo' in state so the store recognises it,
    // though extractRepoRefs only needs the @ token pattern, not a repo list.
    useBoardStore.setState({ repos: [makeRepo('fake-repo', '/fake/repo')] });

    useBoardStore.getState().addUserNote('Worked on @fake-repo and @coruro today.');

    const note = useBoardStore.getState().dayNotes.notes[0];
    expect(note.repoRefs).toContain('fake-repo');
    expect(note.repoRefs).toContain('coruro');
    // Deduplication: each name appears once even if @-mentioned twice
    expect(note.repoRefs.filter((r) => r === 'fake-repo')).toHaveLength(1);
  });

  it('sets an id (non-empty string)', () => {
    useBoardStore.getState().addUserNote('Quick note.');
    const note = useBoardStore.getState().dayNotes.notes[0];
    expect(typeof note.id).toBe('string');
    expect(note.id.length).toBeGreaterThan(0);
  });

  it('collapses windowStart and windowEnd to generatedAt', () => {
    const before = new Date().toISOString();
    useBoardStore.getState().addUserNote('Deploy done.');
    const after = new Date().toISOString();

    const note = useBoardStore.getState().dayNotes.notes[0];
    // All three timestamps must be in the narrow window between before/after
    expect(note.generatedAt >= before).toBe(true);
    expect(note.generatedAt <= after).toBe(true);
    expect(note.windowStart).toBe(note.generatedAt);
    expect(note.windowEnd).toBe(note.generatedAt);
  });

  it('appends multiple notes (does not replace)', () => {
    useBoardStore.getState().addUserNote('First note.');
    useBoardStore.getState().addUserNote('Second note.');

    const notes = useBoardStore.getState().dayNotes.notes;
    expect(notes).toHaveLength(2);
    expect(notes[0].body).toBe('First note.');
    expect(notes[1].body).toBe('Second note.');
  });

  it('produces no repoRefs when body has no @ mentions', () => {
    useBoardStore.getState().addUserNote('Just a plain note without any mentions.');
    const note = useBoardStore.getState().dayNotes.notes[0];
    expect(note.repoRefs).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// updateDayNote
// ══════════════════════════════════════════════════════════════════════════════

describe('updateDayNote', () => {
  /** Seed a note directly into store state and return it. */
  function seedNote(overrides: Partial<DayNote> = {}): DayNote {
    const note: DayNote = {
      id: 'note-abc',
      generatedAt: new Date(Date.now() - 60000).toISOString(),
      windowStart: new Date(Date.now() - 3600000).toISOString(),
      windowEnd: new Date(Date.now() - 60000).toISOString(),
      body: 'Original body.',
      repoRefs: [],
      model: 'test',
      trigger: 'manual',
      ...overrides,
    };
    useBoardStore.setState({ dayNotes: { notes: [note] } });
    return note;
  }

  it('replaces the body of the matching note', () => {
    seedNote({ id: 'note-abc' });
    useBoardStore.getState().updateDayNote('note-abc', 'Updated body.');

    const updated = useBoardStore.getState().dayNotes.notes.find((n) => n.id === 'note-abc');
    expect(updated?.body).toBe('Updated body.');
  });

  it('stamps editedAt as a valid ISO timestamp', () => {
    seedNote({ id: 'note-abc' });
    const before = new Date().toISOString();
    useBoardStore.getState().updateDayNote('note-abc', 'New content.');
    const after = new Date().toISOString();

    const updated = useBoardStore.getState().dayNotes.notes.find((n) => n.id === 'note-abc');
    expect(updated?.editedAt).toBeDefined();
    expect(updated!.editedAt! >= before).toBe(true);
    expect(updated!.editedAt! <= after).toBe(true);
  });

  it('recomputes repoRefs from the new body', () => {
    seedNote({ id: 'note-abc', body: 'Old body.', repoRefs: [] });
    useBoardStore.setState({ repos: [makeRepo('fake-repo', '/fake/repo')] });

    useBoardStore.getState().updateDayNote('note-abc', 'Switched to @fake-repo pipeline.');

    const updated = useBoardStore.getState().dayNotes.notes.find((n) => n.id === 'note-abc');
    expect(updated?.repoRefs).toContain('fake-repo');
  });

  it('clears old repoRefs when new body has no @ mentions', () => {
    seedNote({ id: 'note-abc', body: 'Work on @old-repo.', repoRefs: ['old-repo'] });

    useBoardStore.getState().updateDayNote('note-abc', 'No mentions here.');

    const updated = useBoardStore.getState().dayNotes.notes.find((n) => n.id === 'note-abc');
    expect(updated?.repoRefs).toEqual([]);
  });

  it('leaves other notes untouched', () => {
    const noteA: DayNote = {
      id: 'note-a',
      generatedAt: new Date().toISOString(),
      windowStart: new Date().toISOString(),
      windowEnd: new Date().toISOString(),
      body: 'Note A original.',
      repoRefs: [],
      model: 'test',
      trigger: 'auto',
    };
    const noteB: DayNote = {
      id: 'note-b',
      generatedAt: new Date().toISOString(),
      windowStart: new Date().toISOString(),
      windowEnd: new Date().toISOString(),
      body: 'Note B original.',
      repoRefs: [],
      model: 'test',
      trigger: 'manual',
    };
    useBoardStore.setState({ dayNotes: { notes: [noteA, noteB] } });

    useBoardStore.getState().updateDayNote('note-a', 'Note A updated.');

    const noteAAfter = useBoardStore.getState().dayNotes.notes.find((n) => n.id === 'note-a');
    const noteBAfter = useBoardStore.getState().dayNotes.notes.find((n) => n.id === 'note-b');
    expect(noteAAfter?.body).toBe('Note A updated.');
    expect(noteBAfter?.body).toBe('Note B original.'); // unchanged
    expect(noteBAfter?.editedAt).toBeUndefined(); // editedAt never set on note-b
  });

  it('is a no-op (does not throw) when the id is unknown', () => {
    seedNote({ id: 'note-abc', body: 'Untouched.' });

    // Must not throw
    expect(() => {
      useBoardStore.getState().updateDayNote('non-existent-id', 'Some body.');
    }).not.toThrow();

    // Original note is unchanged
    const note = useBoardStore.getState().dayNotes.notes.find((n) => n.id === 'note-abc');
    expect(note?.body).toBe('Untouched.');
    expect(note?.editedAt).toBeUndefined();
  });

  it('does not alter the total note count', () => {
    useBoardStore.setState({
      dayNotes: {
        notes: [
          {
            id: 'n1',
            generatedAt: new Date().toISOString(),
            windowStart: '',
            windowEnd: '',
            body: 'A',
            repoRefs: [],
            model: 'm',
            trigger: 'manual',
          },
          {
            id: 'n2',
            generatedAt: new Date().toISOString(),
            windowStart: '',
            windowEnd: '',
            body: 'B',
            repoRefs: [],
            model: 'm',
            trigger: 'auto',
          },
        ],
      },
    });

    useBoardStore.getState().updateDayNote('non-existent-id', 'X');

    expect(useBoardStore.getState().dayNotes.notes).toHaveLength(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// generateDayNotes — git_dirty_stat integration
// ══════════════════════════════════════════════════════════════════════════════

describe('generateDayNotes – git_dirty_stat integration', () => {
  it('injects "[uncommitted] ..." context when git_dirty_stat returns a non-empty string', async () => {
    useBoardStore.setState({ repos: [makeRepo('dirty-repo', '/dirty/repo')] });

    let capturedRepos: Array<{ name: string; commits: string[] }> | null = null;

    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'get_token') return Promise.resolve(null);
      if (cmd === 'git_dirty_stat') return Promise.resolve('3 files changed, 42 insertions(+)');
      if (cmd === 'git_commits_since_numstat') return Promise.resolve([]);
      if (cmd === 'ai_day_notes') {
        capturedRepos = (args as { repos: Array<{ name: string; commits: string[] }> }).repos;
        return Promise.resolve(JSON.stringify({ ok: true, body: 'Summary.', model: 'test' }));
      }
      return Promise.resolve('{}');
    });

    await useBoardStore.getState().generateDayNotes('manual');

    // ai_day_notes must have been invoked (dirty-only repo passes activeRepoData filter)
    expect(capturedRepos).not.toBeNull();
    const repoEntry = capturedRepos!.find((r) => r.name === 'dirty-repo');
    expect(repoEntry).toBeDefined();
    // The AI payload is number-free by design (the model parrots digits):
    // it gets the qualitative digest, while exact stats go into the report body.
    expect(repoEntry!.commits.some((line) => line.includes('uncommitted work in progress'))).toBe(
      true,
    );
    expect(repoEntry!.commits.some((line) => /\d/.test(line))).toBe(false);
    // The composed note body carries the exact numbers.
    const notes = useBoardStore.getState().dayNotes.notes;
    const note = notes[notes.length - 1];
    expect(note.body).toContain('3 files changed, 42 insertions(+)');
  });

  it('does NOT inject an [uncommitted] line when git_dirty_stat returns empty string', async () => {
    useBoardStore.setState({ repos: [makeRepo('clean-repo', '/clean/repo')] });

    let capturedRepos: Array<{ name: string; commits: string[] }> | null = null;

    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'get_token') return Promise.resolve(null);
      if (cmd === 'git_dirty_stat') return Promise.resolve(''); // clean
      if (cmd === 'git_commits_since_numstat')
        return Promise.resolve([makeCommit('abc123', 'feat: something')]);
      if (cmd === 'ai_day_notes') {
        capturedRepos = (args as { repos: Array<{ name: string; commits: string[] }> }).repos;
        return Promise.resolve(JSON.stringify({ ok: true, body: 'Clean note.', model: 'test' }));
      }
      return Promise.resolve('{}');
    });

    await useBoardStore.getState().generateDayNotes('manual');

    expect(capturedRepos).not.toBeNull();
    const repoEntry = capturedRepos!.find((r) => r.name === 'clean-repo');
    expect(repoEntry).toBeDefined();
    expect(repoEntry!.commits.some((line) => line.startsWith('[uncommitted]'))).toBe(false);
  });

  it('a dirty-only repo (zero commits) still produces a note', async () => {
    // Zero commits in window but dirty stat is non-empty → repo must appear in
    // activeRepoData and ai_day_notes must be invoked.
    useBoardStore.setState({ repos: [makeRepo('dirty-only', '/dirty-only/repo')] });

    const aiDayNotesSpy = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ ok: true, body: 'Uncommitted work summary.', model: 'test' }),
      );

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_token') return Promise.resolve(null);
      if (cmd === 'git_dirty_stat') return Promise.resolve('2 files changed, 10 insertions(+)');
      if (cmd === 'git_commits_since_numstat') return Promise.resolve([]); // zero commits
      if (cmd === 'ai_day_notes') return aiDayNotesSpy();
      return Promise.resolve('{}');
    });

    await useBoardStore.getState().generateDayNotes('manual');

    // ai_day_notes must have been called (dirty stat alone is enough activity)
    expect(aiDayNotesSpy).toHaveBeenCalledOnce();

    // A note must have been added to the store
    const notes = useBoardStore.getState().dayNotes.notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].trigger).toBe('manual');
  });

  it('git_dirty_stat failure is swallowed (no throw, no error banner)', async () => {
    useBoardStore.setState({ repos: [makeRepo('failing-dirty', '/failing/repo')] });

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_token') return Promise.resolve(null);
      if (cmd === 'git_dirty_stat') return Promise.reject(new Error('git not found'));
      if (cmd === 'git_commits_since_numstat')
        return Promise.resolve([makeCommit('fff000', 'fix: patch')]);
      if (cmd === 'ai_day_notes')
        return Promise.resolve(JSON.stringify({ ok: true, body: 'Note.', model: 'test' }));
      return Promise.resolve('{}');
    });

    // Must not throw
    await expect(useBoardStore.getState().generateDayNotes('manual')).resolves.not.toThrow();

    // generatingNotes must reset to false (finally block)
    expect(useBoardStore.getState().generatingNotes).toBe(false);
    // No error shown for the dirty-stat failure itself
    expect(useBoardStore.getState().notesError).toBeNull();
  });
});
