import { describe, it, expect } from 'vitest';
import { parseHandle, relativeAge, deriveCardData } from './repoStats';
import type { Repo } from '../types';

const FIXED_NOW = Date.parse('2026-06-08T00:00:00Z');

function baseRepo(over: Partial<Repo> = {}): Repo {
  return {
    name: 'MyGITdash',
    path: '/Users/x/Github/MyGITdash',
    branch: 'main',
    dirty: false,
    prCount: 0,
    ...over,
  };
}

describe('parseHandle', () => {
  it('extracts owner from ssh and https remotes', () => {
    expect(parseHandle('git@github.com:felipemillan/MyGITdash.git')).toBe('@felipemillan');
    expect(parseHandle('https://github.com/felipemillan/MyGITdash.git')).toBe('@felipemillan');
    expect(parseHandle('https://github.com/felipemillan/MyGITdash')).toBe('@felipemillan');
  });
  it('returns null for missing or unparseable remotes', () => {
    expect(parseHandle(null)).toBeNull();
    expect(parseHandle('')).toBeNull();
    expect(parseHandle('not-a-url')).toBeNull();
  });
});

describe('relativeAge', () => {
  it('formats elapsed time compactly', () => {
    expect(relativeAge('2026-06-07T00:00:00Z', FIXED_NOW)).toBe('1d');
    expect(relativeAge('2026-05-25T00:00:00Z', FIXED_NOW)).toBe('2w');
    expect(relativeAge('', FIXED_NOW)).toBe('');
  });
});

describe('deriveCardData', () => {
  it('uses GitHub stats when the repo is enriched', () => {
    const repo = baseRepo({
      remoteUrl: 'git@github.com:felipemillan/MyGITdash.git',
      gh: {
        stars: 128, forks: 4, isPrivate: false, archived: false, openIssues: 12,
        prCount: 0, ciStatus: 'success', latestRelease: null, description: 'Git dashboard',
        topics: ['rust', 'tauri'], language: 'Rust', license: 'MIT', defaultBranch: 'main',
        pushedAt: '2026-06-07T00:00:00Z', htmlUrl: 'https://github.com/felipemillan/MyGITdash',
        watchers: 3, updatedAt: '2026-06-07T00:00:00Z', disabled: false, fork: false,
        parent: null, homepage: null, hasIssues: true, hasWiki: false, hasPages: false, size: 100,
      },
    });
    const d = deriveCardData(repo, FIXED_NOW);
    expect(d.isLocalOnly).toBe(false);
    expect(d.handle).toBe('@felipemillan');
    expect(d.displayStats.map((s) => s.label)).toEqual(['STARS', 'ISSUES', 'FORKS']);
    expect(d.displayStats.map((s) => s.value)).toEqual(['128', '12', '4']);
    expect(d.description).toBe('Git dashboard');
    expect(d.tags).toEqual(['rust', 'tauri']);
    expect(d.stale).toBe(false);
  });

  it('falls back to local stats when not enriched', () => {
    const repo = baseRepo({
      commitCount: 340, branchCount: 6, lastCommitAt: '2026-06-05T00:00:00Z',
    });
    const d = deriveCardData(repo, FIXED_NOW);
    expect(d.isLocalOnly).toBe(true);
    expect(d.handle).toBeNull();
    expect(d.displayStats.map((s) => s.label)).toEqual(['COMMITS', 'BRANCHES', 'LAST']);
    expect(d.displayStats.map((s) => s.value)).toEqual(['340', '6', '3d']);
  });

  it('marks repos older than 90 days as stale', () => {
    const repo = baseRepo({ lastCommitAt: '2026-01-01T00:00:00Z' });
    expect(deriveCardData(repo, FIXED_NOW).stale).toBe(true);
  });

  it('prefers aiSummary and aiTags when present', () => {
    const repo = baseRepo({
      aiSummary: 'AI says: a Tauri git board',
      aiTags: ['ai-tag-1', 'ai-tag-2'],
      gh: undefined,
    });
    const d = deriveCardData(repo, FIXED_NOW);
    expect(d.description).toBe('AI says: a Tauri git board');
    expect(d.tags).toEqual(['ai-tag-1', 'ai-tag-2']);
  });
});
