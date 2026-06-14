import { describe, it, expect } from 'vitest';
import {
  parseDirtyStat,
  classifyActivity,
  composeSessionReport,
  type RepoActivity,
} from '../utils/sessionReport';

const act = (over: Partial<RepoActivity>): RepoActivity => ({
  name: 'repo',
  filesChanged: 0,
  insertions: 0,
  deletions: 0,
  untracked: 0,
  commitSubjects: [],
  ...over,
});

describe('parseDirtyStat', () => {
  it('parses the full summary line', () => {
    expect(parseDirtyStat('2 files changed, 83 insertions(+), 1 deletion(-), 5 untracked')).toEqual(
      {
        files: 2,
        insertions: 83,
        deletions: 1,
        untracked: 5,
      },
    );
  });

  it('parses singular forms', () => {
    expect(parseDirtyStat('1 file changed, 1 insertion(+), 1 deletion(-)')).toEqual({
      files: 1,
      insertions: 1,
      deletions: 1,
      untracked: 0,
    });
  });

  it('parses untracked-only and empty strings', () => {
    expect(parseDirtyStat('3 untracked')).toEqual({
      files: 0,
      insertions: 0,
      deletions: 0,
      untracked: 3,
    });
    expect(parseDirtyStat('')).toEqual({ files: 0, insertions: 0, deletions: 0, untracked: 0 });
  });
});

describe('classifyActivity', () => {
  it('high: >500 lines touched', () => {
    expect(classifyActivity(act({ filesChanged: 1, insertions: 3518, deletions: 10975 }))).toBe(
      'high',
    );
  });

  it('high: >8 files changed', () => {
    expect(classifyActivity(act({ filesChanged: 9, insertions: 10, deletions: 5 }))).toBe('high');
  });

  it('high: 10+ untracked with no tracked changes', () => {
    expect(classifyActivity(act({ untracked: 10 }))).toBe('high');
  });

  it('moderate: mid-size change', () => {
    expect(classifyActivity(act({ filesChanged: 5, insertions: 100, deletions: 50 }))).toBe(
      'moderate',
    );
  });

  it('low: 1-2 files, small lines', () => {
    expect(classifyActivity(act({ filesChanged: 2, insertions: 4, deletions: 3 }))).toBe('low');
  });

  it('idle: untracked only, below 10', () => {
    expect(classifyActivity(act({ untracked: 3 }))).toBe('idle');
  });
});

describe('composeSessionReport', () => {
  const sample: RepoActivity[] = [
    act({ name: 'big', filesChanged: 17, insertions: 1509, deletions: 1292, untracked: 2 }),
    act({
      name: 'mid',
      filesChanged: 5,
      insertions: 23,
      deletions: 16,
      untracked: 1,
      commitSubjects: ['feat: add tracker'],
    }),
    act({ name: 'tiny', filesChanged: 1, insertions: 4, deletions: 3 }),
    act({ name: 'sleepy', untracked: 3 }),
  ];

  it('renders all sections with correct totals', () => {
    const md = composeSessionReport(
      sample,
      'I worked mostly on big.',
      new Date('2026-06-13T10:00:00Z'),
    );
    expect(md).toContain('# 📅 Daily Session Summary —');
    expect(md).toContain('**Executive Summary:** I worked mostly on big.');
    expect(md).toContain('- Repos touched: 4');
    expect(md).toContain('- Files changed: 23');
    expect(md).toContain('- Lines: +1,536 / -1,311');
    expect(md).toContain('### 🔴 High Activity / Significant Changes');
    expect(md).toContain('### 🟡 Moderate Activity');
    expect(md).toContain('### 🟢 Low Activity / Minor Tweaks');
    expect(md).toContain('### ⚪ Idle / Untracked Only');
  });

  it('formats entries with stats and uses commit subject as description', () => {
    const md = composeSessionReport(sample, 'x', new Date());
    expect(md).toContain(
      '- @big: Major uncommitted refactor. (17 files changed, 1509 insertions(+), 1292 deletions(-), 2 untracked)',
    );
    expect(md).toContain(
      '- @mid: feat: add tracker. (5 files changed, 23 insertions(+), 16 deletions(-), 1 untracked)',
    );
    expect(md).toContain('- @sleepy (3 untracked)');
  });

  it('omits empty tiers', () => {
    const md = composeSessionReport(
      [act({ name: 'only', filesChanged: 1, insertions: 2, deletions: 1 })],
      'x',
      new Date(),
    );
    expect(md).toContain('### 🟢 Low Activity / Minor Tweaks');
    expect(md).not.toContain('### 🔴');
    expect(md).not.toContain('### ⚪');
  });
});
