import { describe, it, expect } from 'vitest';
import {
  parseDirtyStat,
  classifyActivity,
  composeSessionReport,
  type RepoActivity,
} from '../utils/sessionReport';
import type { ActivityEvent } from '../types';

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
    // WI-1.1: executive summary is a real `##` heading, body on its own line.
    expect(md).toContain('## Executive Summary');
    expect(md).toContain('I worked mostly on big.');
    expect(md).not.toContain('**Executive Summary:**');
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
    // WI-1.3: conventional-commit prefix (`feat:`) is stripped from the subject.
    expect(md).toContain(
      '- @mid: add tracker. (5 files changed, 23 insertions(+), 16 deletions(-), 1 untracked)',
    );
    expect(md).toContain('- @sleepy (3 untracked)');
  });

  it('omits empty tiers', () => {
    // Two low repos so the full skeleton renders (single-repo triggers the
    // WI-1.6 compact path); only the Low tier should appear.
    const md = composeSessionReport(
      [
        act({ name: 'only', filesChanged: 1, insertions: 2, deletions: 1 }),
        act({ name: 'other', filesChanged: 2, insertions: 4, deletions: 3 }),
      ],
      'x',
      new Date(),
    );
    expect(md).toContain('### 🟢 Low Activity / Minor Tweaks');
    expect(md).not.toContain('### 🔴');
    expect(md).not.toContain('### ⚪');
  });

  it('WI-1.6: a single low-tier repo gets a compact one-line note (no skeleton)', () => {
    const md = composeSessionReport(
      [act({ name: 'only', filesChanged: 1, insertions: 2, deletions: 1 })],
      'x',
      new Date(),
    );
    expect(md).toContain('# 📅 Daily Session Summary —');
    expect(md).toContain('@only:');
    expect(md).not.toContain('## 🚦 Repository Status Breakdown');
    expect(md).not.toContain('### 🟢');
    expect(md).not.toContain('## Executive Summary');
  });

  it('WI-1.6: a single high-tier repo still gets the full skeleton', () => {
    const md = composeSessionReport(
      [act({ name: 'big', filesChanged: 17, insertions: 1509, deletions: 1292 })],
      'x',
      new Date(),
    );
    expect(md).toContain('## 🚦 Repository Status Breakdown');
    expect(md).toContain('### 🔴 High Activity / Significant Changes');
  });

  it('existing 3-arg calls (no appEvents) still pass', () => {
    const md = composeSessionReport(sample, 'I worked on multiple repos.', new Date());
    expect(md).toContain('# 📅 Daily Session Summary —');
    expect(md).toContain('## 🚦 Repository Status Breakdown');
    expect(md).not.toContain('## App Activity');
  });
});

describe('composeSessionReport — App Activity section', () => {
  const sampleEvents = (): ActivityEvent[] => [
    { id: 'e1', ts: 1000, kind: 'ask_session_started', repoName: 'myapp' },
    { id: 'e2', ts: 1001, kind: 'ask_session_started', repoName: 'myapp' },
    { id: 'e3', ts: 1002, kind: 'ask_session_ended', repoName: 'myapp' },
    { id: 'e4', ts: 1003, kind: 'run_command_fired', repoName: 'utils', label: 'some label text' },
    { id: 'e5', ts: 1004, kind: 'command_center_opened', repoName: null },
    { id: 'e6', ts: 1005, kind: 'curator_run', repoName: 'config' },
    { id: 'e7', ts: 1006, kind: 'user_note_written', repoName: 'config' },
  ];

  it('omits section when appEvents is undefined', () => {
    const md = composeSessionReport(
      [act({ name: 'repo', filesChanged: 1, insertions: 1, deletions: 0 })],
      'summary',
      new Date(),
      undefined,
    );
    expect(md).not.toContain('## App Activity');
  });

  it('omits section when appEvents is empty array', () => {
    const md = composeSessionReport(
      [act({ name: 'repo', filesChanged: 1, insertions: 1, deletions: 0 })],
      'summary',
      new Date(),
      [],
    );
    expect(md).not.toContain('## App Activity');
  });

  it('renders section with grouped per-kind counts', () => {
    const events = sampleEvents();
    const md = composeSessionReport(
      [act({ name: 'repo', filesChanged: 1, insertions: 1, deletions: 0 })],
      'summary',
      new Date(),
      events,
    );
    expect(md).toContain('## App Activity');
    expect(md).toContain('- Ask sessions started: 2');
    expect(md).toContain('- Ask sessions ended: 1');
    expect(md).toContain('- Run commands fired: 1');
    expect(md).toContain('- Command Center opens: 1');
    expect(md).toContain('- Setup Curator runs: 1');
    expect(md).toContain('- Notes written: 1');
  });

  it('renders @repoName touched-line with sorted, deduped repos', () => {
    const events = sampleEvents();
    const md = composeSessionReport(
      [act({ name: 'repo', filesChanged: 1, insertions: 1, deletions: 0 })],
      'summary',
      new Date(),
      events,
    );
    expect(md).toContain('- Repos touched in-app: @config, @myapp, @utils');
  });

  it('never renders event label values in output', () => {
    const events = sampleEvents();
    const md = composeSessionReport(
      [act({ name: 'repo', filesChanged: 1, insertions: 1, deletions: 0 })],
      'summary',
      new Date(),
      events,
    );
    expect(md).not.toContain('some label text');
  });

  it('same-kind events collapse to one bullet with count>1', () => {
    const events = sampleEvents();
    const md = composeSessionReport(
      [act({ name: 'repo', filesChanged: 1, insertions: 1, deletions: 0 })],
      'summary',
      new Date(),
      events,
    );
    // ask_session_started has 2 events; should render as a single bullet "Ask sessions started: 2"
    const asksStartedMatches = md.match(/- Ask sessions started/g);
    expect(asksStartedMatches).toHaveLength(1);
  });

  it('renders only kinds present in events (omits kinds with count=0)', () => {
    const events: ActivityEvent[] = [
      { id: 'e1', ts: 1000, kind: 'ask_session_started', repoName: 'repo' },
      { id: 'e2', ts: 1001, kind: 'user_note_written', repoName: 'repo' },
    ];
    const md = composeSessionReport(
      [act({ name: 'repo', filesChanged: 1, insertions: 1, deletions: 0 })],
      'summary',
      new Date(),
      events,
    );
    expect(md).toContain('- Ask sessions started: 1');
    expect(md).toContain('- Notes written: 1');
    expect(md).not.toContain('ask_session_ended');
    expect(md).not.toContain('Run commands fired');
    expect(md).not.toContain('Command Center opens');
    expect(md).not.toContain('Setup Curator runs');
  });

  it('omits Repos touched line when all events have repoName=null', () => {
    const events: ActivityEvent[] = [
      { id: 'e1', ts: 1000, kind: 'command_center_opened', repoName: null },
      { id: 'e2', ts: 1001, kind: 'command_center_opened', repoName: null },
    ];
    const md = composeSessionReport(
      [act({ name: 'repo', filesChanged: 1, insertions: 1, deletions: 0 })],
      'summary',
      new Date(),
      events,
    );
    expect(md).toContain('## App Activity');
    expect(md).toContain('- Command Center opens: 2');
    expect(md).not.toContain('Repos touched in-app');
  });
});
