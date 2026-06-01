import { describe, expect, test } from 'vitest';
import { mapPulls, mapCommits, mapIssues } from './githubActivity';

describe('mapPulls', () => {
  test('maps pulls', () => {
    const json = [{ number: 5, title: 'Fix', draft: true, user: { login: 'me' }, html_url: 'u' }];
    expect(mapPulls(json)).toEqual([{ number: 5, title: 'Fix', draft: true, author: 'me', url: 'u' }]);
  });
  test('non-array → []', () => {
    expect(mapPulls(null)).toEqual([]);
  });
});

describe('mapCommits', () => {
  test('first message line + author', () => {
    const json = [{ sha: 'abc', html_url: 'u', commit: { message: 'subject\n\nbody', author: { name: 'A', date: 'd' } } }];
    expect(mapCommits(json)).toEqual([{ sha: 'abc', message: 'subject', author: 'A', date: 'd', url: 'u' }]);
  });
  test('non-array → []', () => {
    expect(mapCommits(undefined)).toEqual([]);
  });
});

describe('mapIssues', () => {
  test('maps issues and filters out PRs', () => {
    const json = [
      { number: 1, title: 'Bug', labels: [{ name: 'bug' }, 'plain'], html_url: 'u1' },
      { number: 2, title: 'A PR', html_url: 'u2', pull_request: { url: 'x' } },
    ];
    expect(mapIssues(json)).toEqual([{ number: 1, title: 'Bug', labels: ['bug', 'plain'], url: 'u1' }]);
  });
  test('non-array → []', () => {
    expect(mapIssues({})).toEqual([]);
  });
});
