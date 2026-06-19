import { describe, it, expect } from 'vitest';
import { parseDailyNote, deriveNotables } from '../utils/parseDailyNote';
import { composeSessionReport, type RepoActivity } from '../utils/sessionReport';
import type { ActivityEvent } from '../types';

// Round-trip tests: compose the real markdown, then parse it back. This binds
// the parser to composeSessionReport's actual output so a format change in one
// breaks the test rather than silently desyncing the bento renderer.

const repo = (over: Partial<RepoActivity> & { name: string }): RepoActivity => ({
  filesChanged: 0,
  insertions: 0,
  deletions: 0,
  untracked: 0,
  commitSubjects: [],
  ...over,
});

const HIGH = repo({
  name: 'alpha',
  filesChanged: 10,
  insertions: 600,
  deletions: 50,
  commitSubjects: ['feat: big engine rewrite', 'fix: crash on boot'],
});
const MODERATE = repo({
  name: 'beta',
  filesChanged: 4,
  insertions: 60,
  deletions: 20,
  commitSubjects: ['refactor: tidy store'],
});
const LOW = repo({ name: 'gamma', filesChanged: 1, insertions: 5, deletions: 1 });
const IDLE = repo({ name: 'delta', untracked: 3 });

const APP_EVENTS: ActivityEvent[] = [
  { id: '1', ts: 1, kind: 'ask_session_started', repoName: 'alpha' },
  { id: '2', ts: 2, kind: 'ask_session_started', repoName: 'beta' },
  { id: '3', ts: 3, kind: 'run_command_fired', repoName: null },
];

describe('parseDailyNote — round-trips composeSessionReport output', () => {
  const md = composeSessionReport(
    [HIGH, MODERATE, LOW, IDLE],
    'Refactored the engine and steadied the store.',
    new Date('2026-06-19T09:30:00'),
    APP_EVENTS,
  );
  const data = parseDailyNote(md);

  it('parses a full multi-repo report (not null)', () => {
    expect(data).not.toBeNull();
  });

  it('extracts the title and date from the H1', () => {
    expect(data?.title).toBe('Daily Session Summary');
    expect(data?.date).toMatch(/2026/);
  });

  it('sorts repos into the correct tiers', () => {
    expect(data?.tiers.high.map((r) => r.name)).toContain('alpha');
    expect(data?.tiers.moderate.map((r) => r.name)).toContain('beta');
    expect(data?.tiers.low.map((r) => r.name)).toContain('gamma');
    expect(data?.tiers.idle.map((r) => r.name)).toContain('delta');
  });

  it('parses per-repo stat numbers and prose description', () => {
    const alpha = data?.tiers.high.find((r) => r.name === 'alpha');
    expect(alpha?.insertions).toBe(600);
    expect(alpha?.deletions).toBe(50);
    expect(alpha?.filesChanged).toBe(10);
    // conventional-commit prefixes stripped, first two joined with " and "
    expect(alpha?.description).toBe('big engine rewrite and crash on boot');
  });

  it('parses the idle repo untracked count', () => {
    const delta = data?.tiers.idle.find((r) => r.name === 'delta');
    expect(delta?.untracked).toBe(3);
  });

  it('parses the global metrics block', () => {
    expect(data?.metrics.reposTouched).toBe(4);
    expect(data?.metrics.filesChanged).toBe(15); // 10 + 4 + 1 + 0
    expect(data?.metrics.insertions).toBe(665); // 600 + 60 + 5
    expect(data?.metrics.deletions).toBe(71); // 50 + 20 + 1
  });

  it('captures the executive summary verbatim', () => {
    expect(data?.executiveSummary).toBe('Refactored the engine and steadied the store.');
  });

  it('parses the app-activity section into label/value events', () => {
    const labels = data?.appActivity.map((e) => e.label) ?? [];
    expect(labels).toContain('Ask sessions started');
    expect(labels).toContain('Run commands fired');
  });
});

describe('parseDailyNote — coverage label', () => {
  it('captures the italic coverage line under the H1', () => {
    const md = composeSessionReport(
      [HIGH, MODERATE],
      'Steady progress.',
      new Date('2026-06-19T09:30:00'),
      undefined,
      'Covering activity since Jun 15, 2026',
    );
    expect(parseDailyNote(md)?.coverageLabel).toBe('Covering activity since Jun 15, 2026');
  });
});

describe('parseDailyNote — non-summary bodies fall back to null', () => {
  it('returns null for a plain user note', () => {
    expect(parseDailyNote('Just a quick thought about @alpha — looks good.')).toBeNull();
  });

  it('returns null for the compact single-repo note (no metrics section)', () => {
    const md = composeSessionReport([LOW], 'n/a', new Date('2026-06-19T09:30:00'));
    // compact note has the H1 but no "## Global Activity Metrics"
    expect(md).not.toContain('Global Activity Metrics');
    expect(parseDailyNote(md)).toBeNull();
  });
});

describe('deriveNotables', () => {
  it('ranks standouts by lines touched and caps the list', () => {
    const md = composeSessionReport(
      [HIGH, MODERATE, LOW, IDLE],
      'x',
      new Date('2026-06-19T09:30:00'),
    );
    const data = parseDailyNote(md)!;
    const notables = deriveNotables(data, 2);
    expect(notables).toHaveLength(2);
    expect(notables[0].name).toBe('alpha'); // most lines touched leads
    // idle repo (no tracked lines) is never a notable
    expect(notables.map((r) => r.name)).not.toContain('delta');
  });
});
