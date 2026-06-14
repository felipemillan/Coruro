import { describe, expect, test } from 'vitest';
import type { Repo, RepoGitHub } from '../types';
import { matchesSearch, passesFilters, sortRepos, applyView } from './filterSort';
import { STALE_DAYS } from '../view';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGH(overrides: Partial<RepoGitHub> = {}): RepoGitHub {
  return {
    stars: 0,
    forks: 0,
    isPrivate: false,
    archived: false,
    openIssues: 0,
    prCount: 0,
    ciStatus: 'none',
    latestRelease: null,
    description: null,
    topics: [],
    language: null,
    license: null,
    defaultBranch: 'main',
    pushedAt: '',
    htmlUrl: '',
    watchers: 0,
    updatedAt: '',
    disabled: false,
    fork: false,
    parent: null,
    homepage: null,
    hasIssues: false,
    hasWiki: false,
    hasPages: false,
    size: 0,
    ...overrides,
  };
}

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    name: 'my-repo',
    path: '/repos/my-repo',
    branch: 'main',
    dirty: false,
    prCount: 0,
    remoteUrl: null,
    gh: null,
    ...overrides,
  };
}

/** ISO date string for a date that is `daysAgo` days in the past. */
function daysAgoISO(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

// ---------------------------------------------------------------------------
// matchesSearch
// ---------------------------------------------------------------------------

describe('matchesSearch', () => {
  test('empty query always matches', () => {
    expect(matchesSearch(makeRepo(), '')).toBe(true);
  });

  test('whitespace-only query always matches', () => {
    expect(matchesSearch(makeRepo(), '   ')).toBe(true);
  });

  test('matches repo name case-insensitively', () => {
    const repo = makeRepo({ name: 'FooBar' });
    expect(matchesSearch(repo, 'foobar')).toBe(true);
    expect(matchesSearch(repo, 'FOO')).toBe(true);
    expect(matchesSearch(repo, 'bar')).toBe(true);
  });

  test('does not match unrelated query', () => {
    const repo = makeRepo({ name: 'my-repo' });
    expect(matchesSearch(repo, 'zzz')).toBe(false);
  });

  test('matches against branch', () => {
    const repo = makeRepo({ branch: 'feat/dashboard' });
    expect(matchesSearch(repo, 'dashboard')).toBe(true);
    expect(matchesSearch(repo, 'FEAT')).toBe(true);
  });

  test('matches against gh.language', () => {
    const repo = makeRepo({ gh: makeGH({ language: 'TypeScript' }) });
    expect(matchesSearch(repo, 'typescript')).toBe(true);
    expect(matchesSearch(repo, 'Type')).toBe(true);
  });

  test('gh is null → language treated as empty string', () => {
    const repo = makeRepo({ gh: null });
    expect(matchesSearch(repo, 'typescript')).toBe(false);
    // name still searched
    expect(matchesSearch(repo, 'my-repo')).toBe(true);
  });

  test('gh.language is null → treated as empty string', () => {
    const repo = makeRepo({ gh: makeGH({ language: null }) });
    expect(matchesSearch(repo, 'rust')).toBe(false);
  });

  test('query must be substring of ONE field — does not straddle fields', () => {
    // name = 'alpha', branch = 'beta' — 'alphabeta' should NOT match
    const repo = makeRepo({ name: 'alpha', branch: 'beta' });
    expect(matchesSearch(repo, 'alphabeta')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// passesFilters
// ---------------------------------------------------------------------------

describe('passesFilters', () => {
  test('empty filter set always passes', () => {
    expect(passesFilters(makeRepo(), new Set())).toBe(true);
  });

  // dirty
  test('dirty filter: true when repo.dirty=true', () => {
    expect(passesFilters(makeRepo({ dirty: true }), new Set(['dirty']))).toBe(true);
  });
  test('dirty filter: false when repo.dirty=false', () => {
    expect(passesFilters(makeRepo({ dirty: false }), new Set(['dirty']))).toBe(false);
  });

  // prs
  test('prs filter: true when prCount > 0', () => {
    expect(passesFilters(makeRepo({ gh: makeGH({ prCount: 3 }) }), new Set(['prs']))).toBe(true);
  });
  test('prs filter: false when prCount = 0', () => {
    expect(passesFilters(makeRepo({ gh: makeGH({ prCount: 0 }) }), new Set(['prs']))).toBe(false);
  });
  test('prs filter: false when gh is null', () => {
    expect(passesFilters(makeRepo({ gh: null }), new Set(['prs']))).toBe(false);
  });

  // issues
  test('issues filter: true when openIssues > 0', () => {
    expect(passesFilters(makeRepo({ gh: makeGH({ openIssues: 1 }) }), new Set(['issues']))).toBe(
      true,
    );
  });
  test('issues filter: false when openIssues = 0', () => {
    expect(passesFilters(makeRepo({ gh: makeGH({ openIssues: 0 }) }), new Set(['issues']))).toBe(
      false,
    );
  });
  test('issues filter: false when gh is null', () => {
    expect(passesFilters(makeRepo({ gh: null }), new Set(['issues']))).toBe(false);
  });

  // stale
  test('stale filter: true when age > STALE_DAYS', () => {
    const pushedAt = daysAgoISO(STALE_DAYS + 1);
    expect(passesFilters(makeRepo({ gh: makeGH({ pushedAt }) }), new Set(['stale']))).toBe(true);
  });
  test('stale filter: false when age exactly = STALE_DAYS (boundary, not strictly greater)', () => {
    const pushedAt = daysAgoISO(STALE_DAYS);
    expect(passesFilters(makeRepo({ gh: makeGH({ pushedAt }) }), new Set(['stale']))).toBe(false);
  });
  test('stale filter: false when age < STALE_DAYS', () => {
    const pushedAt = daysAgoISO(STALE_DAYS - 1);
    expect(passesFilters(makeRepo({ gh: makeGH({ pushedAt }) }), new Set(['stale']))).toBe(false);
  });
  test('stale filter: false when pushedAt is empty string', () => {
    expect(passesFilters(makeRepo({ gh: makeGH({ pushedAt: '' }) }), new Set(['stale']))).toBe(
      false,
    );
  });
  test('stale filter: false when pushedAt is unparseable', () => {
    expect(
      passesFilters(makeRepo({ gh: makeGH({ pushedAt: 'not-a-date' }) }), new Set(['stale'])),
    ).toBe(false);
  });
  test('stale filter: false when gh is null', () => {
    expect(passesFilters(makeRepo({ gh: null }), new Set(['stale']))).toBe(false);
  });

  // private
  test('private filter: true when isPrivate=true', () => {
    expect(passesFilters(makeRepo({ gh: makeGH({ isPrivate: true }) }), new Set(['private']))).toBe(
      true,
    );
  });
  test('private filter: false when isPrivate=false', () => {
    expect(
      passesFilters(makeRepo({ gh: makeGH({ isPrivate: false }) }), new Set(['private'])),
    ).toBe(false);
  });
  test('private filter: false when gh is null', () => {
    expect(passesFilters(makeRepo({ gh: null }), new Set(['private']))).toBe(false);
  });

  // fork
  test('fork filter: true when fork=true', () => {
    expect(passesFilters(makeRepo({ gh: makeGH({ fork: true }) }), new Set(['fork']))).toBe(true);
  });
  test('fork filter: false when fork=false', () => {
    expect(passesFilters(makeRepo({ gh: makeGH({ fork: false }) }), new Set(['fork']))).toBe(false);
  });
  test('fork filter: false when gh is null', () => {
    expect(passesFilters(makeRepo({ gh: null }), new Set(['fork']))).toBe(false);
  });

  // ciFailing
  test('ciFailing filter: true when ciStatus=failure', () => {
    expect(
      passesFilters(makeRepo({ gh: makeGH({ ciStatus: 'failure' }) }), new Set(['ciFailing'])),
    ).toBe(true);
  });
  test('ciFailing filter: false when ciStatus=success', () => {
    expect(
      passesFilters(makeRepo({ gh: makeGH({ ciStatus: 'success' }) }), new Set(['ciFailing'])),
    ).toBe(false);
  });
  test('ciFailing filter: false when ciStatus=pending', () => {
    expect(
      passesFilters(makeRepo({ gh: makeGH({ ciStatus: 'pending' }) }), new Set(['ciFailing'])),
    ).toBe(false);
  });
  test('ciFailing filter: false when ciStatus=none', () => {
    expect(
      passesFilters(makeRepo({ gh: makeGH({ ciStatus: 'none' }) }), new Set(['ciFailing'])),
    ).toBe(false);
  });
  test('ciFailing filter: false when gh is null', () => {
    expect(passesFilters(makeRepo({ gh: null }), new Set(['ciFailing']))).toBe(false);
  });

  // AND semantics
  test('multiple filters: all must pass (AND)', () => {
    const repo = makeRepo({ dirty: true, gh: makeGH({ prCount: 2, isPrivate: false }) });
    // dirty + prs → both pass
    expect(passesFilters(repo, new Set(['dirty', 'prs']))).toBe(true);
    // dirty + private → private fails
    expect(passesFilters(repo, new Set(['dirty', 'private']))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sortRepos
// ---------------------------------------------------------------------------

describe('sortRepos', () => {
  const repoA = makeRepo({
    name: 'alpha',
    gh: makeGH({ stars: 10, pushedAt: '2026-01-01T00:00:00Z' }),
  });
  const repoB = makeRepo({
    name: 'beta',
    gh: makeGH({ stars: 50, pushedAt: '2026-03-01T00:00:00Z' }),
  });
  const repoC = makeRepo({
    name: 'gamma',
    gh: makeGH({ stars: 10, pushedAt: '2025-06-01T00:00:00Z' }),
  });
  const repoD = makeRepo({ name: 'delta', gh: null }); // no gh data

  test('manual: returns new array preserving original order', () => {
    const input = [repoB, repoA, repoC];
    const result = sortRepos(input, 'manual');
    expect(result).not.toBe(input); // new array
    expect(result.map((r) => r.name)).toEqual(['beta', 'alpha', 'gamma']);
  });

  test('manual: does not mutate input', () => {
    const input = [repoB, repoA];
    const copy = [...input];
    sortRepos(input, 'manual');
    expect(input).toEqual(copy);
  });

  test('name: sorts ascending by name', () => {
    const result = sortRepos([repoC, repoA, repoB], 'name');
    expect(result.map((r) => r.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('pushed: newest pushedAt first', () => {
    const result = sortRepos([repoA, repoC, repoB], 'pushed');
    // B=Mar2026 > A=Jan2026 > C=Jun2025
    expect(result.map((r) => r.name)).toEqual(['beta', 'alpha', 'gamma']);
  });

  test('pushed: missing/empty pushedAt sorts to bottom', () => {
    const result = sortRepos([repoD, repoB, repoA], 'pushed');
    expect(result[result.length - 1].name).toBe('delta');
  });

  test('pushed: gh=null sorts to bottom', () => {
    const result = sortRepos([repoC, repoD, repoA], 'pushed');
    expect(result[result.length - 1].name).toBe('delta');
  });

  test('stars: highest stars first', () => {
    const result = sortRepos([repoA, repoB, repoC], 'stars');
    // B=50, A=10, C=10 (tie → alpha < gamma)
    expect(result[0].name).toBe('beta');
    expect(result[1].name).toBe('alpha');
    expect(result[2].name).toBe('gamma');
  });

  test('stars: repos with no gh treated as 0 stars', () => {
    const repoZero = makeRepo({ name: 'aardvark', gh: makeGH({ stars: 0 }) });
    const result = sortRepos([repoD, repoZero], 'stars');
    // both 0 stars → fall back to name asc: aardvark < delta
    expect(result.map((r) => r.name)).toEqual(['aardvark', 'delta']);
  });

  test('sortRepos does not mutate input for any mode', () => {
    const input = [repoB, repoA, repoC, repoD];
    const names = input.map((r) => r.name);
    for (const mode of ['manual', 'pushed', 'name', 'stars'] as const) {
      sortRepos(input, mode);
    }
    expect(input.map((r) => r.name)).toEqual(names);
  });
});

// ---------------------------------------------------------------------------
// applyView
// ---------------------------------------------------------------------------

describe('applyView', () => {
  const repoPrivateTS = makeRepo({
    name: 'private-ts',
    branch: 'main',
    gh: makeGH({
      isPrivate: true,
      language: 'TypeScript',
      stars: 5,
      pushedAt: '2026-05-01T00:00:00Z',
    }),
  });
  const repoDirtyRust = makeRepo({
    name: 'dirty-rust',
    branch: 'dev',
    dirty: true,
    gh: makeGH({ language: 'Rust', stars: 20, pushedAt: '2026-04-01T00:00:00Z' }),
  });
  const repoPlain = makeRepo({
    name: 'plain',
    branch: 'main',
    gh: makeGH({ stars: 1, pushedAt: '2024-01-01T00:00:00Z' }),
  });

  test('empty search + empty filters + manual = pass-through in original order', () => {
    const input = [repoPrivateTS, repoDirtyRust, repoPlain];
    const result = applyView(input, { search: '', filters: new Set(), sort: 'manual' });
    expect(result.map((r) => r.name)).toEqual(['private-ts', 'dirty-rust', 'plain']);
  });

  test('search filters correctly', () => {
    const input = [repoPrivateTS, repoDirtyRust, repoPlain];
    const result = applyView(input, { search: 'rust', filters: new Set(), sort: 'manual' });
    expect(result.map((r) => r.name)).toEqual(['dirty-rust']);
  });

  test('filter reduces results', () => {
    const input = [repoPrivateTS, repoDirtyRust, repoPlain];
    const result = applyView(input, { search: '', filters: new Set(['dirty']), sort: 'manual' });
    expect(result.map((r) => r.name)).toEqual(['dirty-rust']);
  });

  test('sort applies after filter', () => {
    const input = [repoPlain, repoDirtyRust, repoPrivateTS];
    const result = applyView(input, { search: '', filters: new Set(), sort: 'stars' });
    // stars: dirty-rust=20, private-ts=5, plain=1
    expect(result.map((r) => r.name)).toEqual(['dirty-rust', 'private-ts', 'plain']);
  });

  test('search + filter combined (AND)', () => {
    const input = [repoPrivateTS, repoDirtyRust, repoPlain];
    // search for 'main' (branch) AND private filter → only private-ts
    const result = applyView(input, {
      search: 'main',
      filters: new Set(['private']),
      sort: 'manual',
    });
    expect(result.map((r) => r.name)).toEqual(['private-ts']);
  });

  test('search + filter combined → no results', () => {
    const input = [repoPrivateTS, repoDirtyRust, repoPlain];
    const result = applyView(input, {
      search: 'rust',
      filters: new Set(['private']),
      sort: 'manual',
    });
    expect(result).toEqual([]);
  });

  test('returns a new array even with no filtering', () => {
    const input = [repoPlain];
    const result = applyView(input, { search: '', filters: new Set(), sort: 'manual' });
    expect(result).not.toBe(input);
  });

  test('pushed sort inside applyView — newest first', () => {
    const input = [repoPlain, repoPrivateTS, repoDirtyRust];
    const result = applyView(input, { search: '', filters: new Set(), sort: 'pushed' });
    // May2026 > Apr2026 > Jan2024
    expect(result.map((r) => r.name)).toEqual(['private-ts', 'dirty-rust', 'plain']);
  });
});
