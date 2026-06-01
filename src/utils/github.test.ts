import { describe, expect, test } from 'vitest';
import { parseRemote, mapRepoMeta, mapCiStatus, mapRelease } from './github';

describe('parseRemote', () => {
  test('scp ssh', () => {
    expect(parseRemote('git@github.com:owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
  });
  test('https with .git', () => {
    expect(parseRemote('https://github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
  });
  test('https no .git, trailing slash', () => {
    expect(parseRemote('https://github.com/owner/repo/')).toEqual({ owner: 'owner', repo: 'repo' });
  });
  test('https with userinfo', () => {
    expect(parseRemote('https://user:pat@github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
  });
  test('non-github returns null', () => {
    expect(parseRemote('https://gitlab.com/owner/repo.git')).toBeNull();
  });
});

describe('mapRepoMeta', () => {
  test('maps fields with defaults', () => {
    const json = {
      stargazers_count: 12, forks_count: 3, private: true, archived: false,
      description: 'hi', topics: ['a', 'b'], language: 'TypeScript',
      license: { spdx_id: 'MIT' }, default_branch: 'main',
      pushed_at: '2026-06-01T00:00:00Z', open_issues_count: 7,
      subscribers_count: 5, updated_at: '2026-05-30T00:00:00Z', disabled: false,
      fork: true, parent: { full_name: 'up/stream', html_url: 'https://github.com/up/stream' },
      homepage: 'https://x.dev', has_issues: true, has_wiki: false, has_pages: true, size: 2048,
    };
    expect(mapRepoMeta(json)).toEqual({
      stars: 12, forks: 3, isPrivate: true, archived: false,
      description: 'hi', topics: ['a', 'b'], language: 'TypeScript',
      license: 'MIT', defaultBranch: 'main',
      pushedAt: '2026-06-01T00:00:00Z', openIssuesRaw: 7,
      watchers: 5, updatedAt: '2026-05-30T00:00:00Z', disabled: false,
      fork: true, parent: { fullName: 'up/stream', url: 'https://github.com/up/stream' },
      homepage: 'https://x.dev', hasIssues: true, hasWiki: false, hasPages: true, size: 2048,
    });
  });
  test('NOASSERTION license → null; missing fields → defaults', () => {
    const r = mapRepoMeta({ license: { spdx_id: 'NOASSERTION' } });
    expect(r.license).toBeNull();
    expect(r.stars).toBe(0);
    expect(r.topics).toEqual([]);
    expect(r.description).toBeNull();
    expect(r.watchers).toBe(0);
    expect(r.fork).toBe(false);
    expect(r.parent).toBeNull();
    expect(r.homepage).toBeNull();
    expect(r.hasIssues).toBe(false);
    expect(r.size).toBe(0);
    expect(r.updatedAt).toBe('');
  });
  test('non-object → all defaults', () => {
    expect(mapRepoMeta(null).stars).toBe(0);
  });
  test('empty homepage string → null', () => {
    expect(mapRepoMeta({ homepage: '' }).homepage).toBeNull();
  });
});

describe('mapCiStatus', () => {
  test('success conclusion', () => {
    expect(mapCiStatus({ workflow_runs: [{ conclusion: 'success', status: 'completed' }] })).toBe('success');
  });
  test('failure conclusions', () => {
    expect(mapCiStatus({ workflow_runs: [{ conclusion: 'failure' }] })).toBe('failure');
    expect(mapCiStatus({ workflow_runs: [{ conclusion: 'timed_out' }] })).toBe('failure');
  });
  test('in-progress → pending', () => {
    expect(mapCiStatus({ workflow_runs: [{ conclusion: null, status: 'in_progress' }] })).toBe('pending');
  });
  test('no runs → none', () => {
    expect(mapCiStatus({ workflow_runs: [] })).toBe('none');
    expect(mapCiStatus({})).toBe('none');
  });
});

describe('mapRelease', () => {
  test('maps tag + date', () => {
    expect(mapRelease({ tag_name: 'v1.2', published_at: '2026-05-01T00:00:00Z' }))
      .toEqual({ tag: 'v1.2', publishedAt: '2026-05-01T00:00:00Z' });
  });
  test('missing tag → null', () => {
    expect(mapRelease({})).toBeNull();
    expect(mapRelease(null)).toBeNull();
  });
});
