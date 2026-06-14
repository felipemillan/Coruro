// githubActivity.ts — lazy, modal-only GitHub fetchers (open PRs, recent
// commits, recent issues). Pure mappers are unit-tested; fetchActivity is a
// thin wrapper verified by running the app.

import { ghJson } from './githubClient';
import type { GitHubCoords } from './github';

export interface GhPull {
  number: number;
  title: string;
  draft: boolean;
  author: string;
  url: string;
}
export interface GhCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}
export interface GhIssue {
  number: number;
  title: string;
  labels: string[];
  url: string;
}
export interface GhActivity {
  prs: GhPull[];
  commits: GhCommit[];
  issues: GhIssue[];
}

/** Pure. Map /pulls payload to GhPull[]. */
export function mapPulls(json: unknown): GhPull[] {
  if (!Array.isArray(json)) return [];
  return json.map((p) => {
    const o = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
    const user = (typeof o.user === 'object' && o.user !== null ? o.user : {}) as Record<
      string,
      unknown
    >;
    return {
      number: typeof o.number === 'number' ? o.number : 0,
      title: typeof o.title === 'string' ? o.title : '',
      draft: o.draft === true,
      author: typeof user.login === 'string' ? user.login : '',
      url: typeof o.html_url === 'string' ? o.html_url : '',
    };
  });
}

/** Pure. Map /commits payload to GhCommit[] (first message line only). */
export function mapCommits(json: unknown): GhCommit[] {
  if (!Array.isArray(json)) return [];
  return json.map((c) => {
    const o = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>;
    const commit = (typeof o.commit === 'object' && o.commit !== null ? o.commit : {}) as Record<
      string,
      unknown
    >;
    const author = (
      typeof commit.author === 'object' && commit.author !== null ? commit.author : {}
    ) as Record<string, unknown>;
    const message = typeof commit.message === 'string' ? commit.message.split('\n')[0] : '';
    return {
      sha: typeof o.sha === 'string' ? o.sha : '',
      message,
      author: typeof author.name === 'string' ? author.name : '',
      date: typeof author.date === 'string' ? author.date : '',
      url: typeof o.html_url === 'string' ? o.html_url : '',
    };
  });
}

/** Pure. Map /issues payload to GhIssue[], excluding PRs (which the endpoint also returns). */
export function mapIssues(json: unknown): GhIssue[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((i) => {
      const o = (typeof i === 'object' && i !== null ? i : {}) as Record<string, unknown>;
      return o.pull_request === undefined;
    })
    .map((i) => {
      const o = (typeof i === 'object' && i !== null ? i : {}) as Record<string, unknown>;
      const labels = Array.isArray(o.labels)
        ? o.labels
            .map((l) => {
              if (typeof l === 'string') return l;
              const lo = (typeof l === 'object' && l !== null ? l : {}) as Record<string, unknown>;
              return typeof lo.name === 'string' ? lo.name : '';
            })
            .filter((s) => s.length > 0)
        : [];
      return {
        number: typeof o.number === 'number' ? o.number : 0,
        title: typeof o.title === 'string' ? o.title : '',
        labels,
        url: typeof o.html_url === 'string' ? o.html_url : '',
      };
    });
}

/**
 * Fetch modal activity (PRs, commits, issues) concurrently.
 *
 * A partial failure degrades that section to an empty array. But if ALL three
 * calls are blocked by auth/rate-limit/network, that is NOT "no activity" — it
 * is a failed fetch, so we throw a clear message instead of silently showing
 * an empty pane (the symptom that made this look like a black box).
 */
export async function fetchActivity(coords: GitHubCoords, token?: string): Promise<GhActivity> {
  const base = `/repos/${coords.owner}/${coords.repo}`;
  const [pulls, commits, issues] = await Promise.all([
    ghJson<unknown>(`${base}/pulls?state=open&per_page=20`, token),
    ghJson<unknown>(`${base}/commits?per_page=10`, token),
    ghJson<unknown>(`${base}/issues?state=open&per_page=20`, token),
  ]);

  const statuses = [pulls.status, commits.status, issues.status];
  const blocked = (s: number): boolean => s === 401 || s === 403 || s === 0;
  if (statuses.every(blocked)) {
    throw new Error(
      statuses[0] === 0
        ? 'Could not reach GitHub (network error).'
        : 'GitHub returned 401/403 — rate limit hit or no/invalid token. Add a GitHub token in Settings.',
    );
  }

  return {
    prs: mapPulls(pulls.data),
    commits: mapCommits(commits.data),
    issues: mapIssues(issues.data),
  };
}
