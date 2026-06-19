import { describe, it, expect } from 'vitest';
import { buildAiLines } from '../store/githubDayNotes';
import type { EnrichedRepoEntry, CommitDetail } from '../utils/dayNotesContext';
import type { RepoActivity } from '../utils/sessionReport';

const mkCommit = (over: Partial<CommitDetail> = {}): CommitDetail => ({
  sha: 'aaa111',
  subject: 'feat: thing',
  files: ['src/store/a.ts'],
  folders: ['src/store'],
  added: 1,
  deleted: 0,
  ...over,
});

const mkEntry = (over: Partial<EnrichedRepoEntry> = {}): EnrichedRepoEntry => ({
  repoName: 'repo',
  commits: [],
  prs: [],
  events: [],
  ciLines: [],
  ...over,
});

const mkActivity = (over: Partial<RepoActivity> = {}): RepoActivity => ({
  name: 'repo',
  filesChanged: 0,
  insertions: 0,
  deletions: 0,
  untracked: 0,
  commitSubjects: [],
  ...over,
});

describe('buildAiLines — WI-2.3 digit-free intent hints', () => {
  const HINT_RE = /^(?:branch|dirs|pr-context|ci-failure):/;

  it('emits branch / dirs / pr-context / ci-failure hints from data in hand', () => {
    const lines = buildAiLines(
      mkEntry({
        commits: [mkCommit({ folders: ['src/store', 'src-tauri/src'] })],
        prs: ['PR #12: Add the sidebar toggle (+5/-2, 3 files)'],
        ciLines: ['[CI] FAIL: build-and-test on feat/phase2'],
      }),
      mkActivity({
        filesChanged: 2,
        insertions: 10,
        deletions: 1,
        commitSubjects: ['feat: thing'],
      }),
      'feat/daily-notes-phase2',
    );
    const hints = lines.filter((l) => HINT_RE.test(l));
    expect(hints.some((l) => l.startsWith('branch:'))).toBe(true);
    expect(hints.some((l) => l.startsWith('dirs:'))).toBe(true);
    expect(hints.some((l) => l.startsWith('pr-context:'))).toBe(true);
    expect(hints.some((l) => l.startsWith('ci-failure:'))).toBe(true);
  });

  it('never lets a hint line carry a bare digit (the model parrots numbers)', () => {
    const lines = buildAiLines(
      mkEntry({
        commits: [mkCommit({ folders: ['src/store'] })],
        prs: ['PR #1234: Bump deps to v2 and fix 7 things'],
        ciLines: ['[CI] FAIL: e2e-run-3 on main'],
      }),
      mkActivity({ filesChanged: 1, insertions: 1, commitSubjects: ['x'] }),
      'fix/issue-42',
    );
    for (const h of lines.filter((l) => HINT_RE.test(l))) {
      expect(h).not.toMatch(/\d/);
    }
  });

  it('skips uninformative default branches and adds nothing for an empty repo', () => {
    expect(buildAiLines(mkEntry(), mkActivity(), 'main')).toEqual([]);
  });
});
