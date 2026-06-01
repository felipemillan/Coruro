/**
 * GitHub utility helpers for MyGITdash.
 *
 * Exports:
 *  - `parseRemote`   — extracts {owner, repo} from a git remote URL
 *  - `mapRepoMeta`   — pure mapper for /repos/{o}/{r} payload
 *  - `mapCiStatus`   — pure mapper for /actions/runs payload
 *  - `mapRelease`    — pure mapper for /releases/latest payload
 *  - `fetchRepoCard` — fetches card-level GitHub data (4 endpoints concurrently)
 *
 * No `any`. Token is optional; when absent the request is unauthenticated
 * (60 req/hr rate limit applies). Token is passed through from the macOS
 * Keychain via the Rust `get_token` command — never stored in JS state.
 */

import { ghJson } from './githubClient';
import type { CiStatus, RepoGitHub } from '../types';

/** Structured representation of a GitHub repository coordinate. */
export interface GitHubCoords {
  owner: string;
  repo: string;
}

/**
 * Parse a git remote URL into `{owner, repo}`.
 *
 * Handles:
 *  - SCP SSH:        `git@github.com:owner/repo.git`
 *  - HTTPS:          `https://github.com/owner/repo[.git][/]`
 *  - HTTPS+userinfo: `https://user:pat@github.com/owner/repo.git`
 *  - ssh:// scheme:  `ssh://git@github.com/owner/repo.git`
 *  - git:// scheme:  `git://github.com/owner/repo.git`
 *  - Trailing slash: any of the above ending with `/`
 *
 * Returns `null` for any URL that is not a recognisable github.com remote.
 */
export function parseRemote(url: string): GitHubCoords | null {
  // Single regex covering SCP-SSH, ssh://, git://, https:// (with optional userinfo),
  // optional .git suffix, and optional trailing slash.
  const m =
    /^(?:(?:https?|git|ssh):\/\/)?(?:[^@/]*@)?github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  if (m !== null) {
    return { owner: m[1], repo: m[2] };
  }

  return null;
}

/** Card-level slice of /repos/{o}/{r}; `openIssuesRaw` still includes PRs. */
export interface RepoMetaSlice {
  stars: number;
  forks: number;
  isPrivate: boolean;
  archived: boolean;
  description: string | null;
  topics: string[];
  language: string | null;
  license: string | null;
  defaultBranch: string;
  pushedAt: string;
  htmlUrl: string;
  openIssuesRaw: number;
  watchers: number;
  updatedAt: string;
  disabled: boolean;
  fork: boolean;
  parent: { fullName: string; url: string } | null;
  homepage: string | null;
  hasIssues: boolean;
  hasWiki: boolean;
  hasPages: boolean;
  size: number;
}

/** Pure. Map a /repos/{o}/{r} payload to RepoMetaSlice. Defaults on missing fields. */
export function mapRepoMeta(json: unknown): RepoMetaSlice {
  const o = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  const licObj = o.license;
  const spdx =
    typeof licObj === 'object' && licObj !== null && typeof (licObj as Record<string, unknown>).spdx_id === 'string'
      ? ((licObj as Record<string, unknown>).spdx_id as string)
      : null;
  const parentObj = o.parent;
  const parent =
    typeof parentObj === 'object' && parentObj !== null && typeof (parentObj as Record<string, unknown>).full_name === 'string'
      ? {
          fullName: (parentObj as Record<string, unknown>).full_name as string,
          url:
            typeof (parentObj as Record<string, unknown>).html_url === 'string'
              ? ((parentObj as Record<string, unknown>).html_url as string)
              : '',
        }
      : null;
  const homepageRaw = o.homepage;
  const homepage = typeof homepageRaw === 'string' && homepageRaw.length > 0 ? homepageRaw : null;
  return {
    stars: typeof o.stargazers_count === 'number' ? o.stargazers_count : 0,
    forks: typeof o.forks_count === 'number' ? o.forks_count : 0,
    isPrivate: o.private === true,
    archived: o.archived === true,
    description: typeof o.description === 'string' ? o.description : null,
    topics: Array.isArray(o.topics) ? o.topics.filter((t): t is string => typeof t === 'string') : [],
    language: typeof o.language === 'string' ? o.language : null,
    license: spdx === 'NOASSERTION' ? null : spdx,
    defaultBranch: typeof o.default_branch === 'string' ? o.default_branch : '',
    pushedAt: typeof o.pushed_at === 'string' ? o.pushed_at : '',
    htmlUrl: typeof o.html_url === 'string' ? o.html_url : '',
    openIssuesRaw: typeof o.open_issues_count === 'number' ? o.open_issues_count : 0,
    watchers: typeof o.subscribers_count === 'number' ? o.subscribers_count : 0,
    updatedAt: typeof o.updated_at === 'string' ? o.updated_at : '',
    disabled: o.disabled === true,
    fork: o.fork === true,
    parent,
    homepage,
    hasIssues: o.has_issues === true,
    hasWiki: o.has_wiki === true,
    hasPages: o.has_pages === true,
    size: typeof o.size === 'number' ? o.size : 0,
  };
}

/** Pure. Derive CI status from /actions/runs?per_page=1. */
export function mapCiStatus(json: unknown): CiStatus {
  const o = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  const runs = o.workflow_runs;
  if (!Array.isArray(runs) || runs.length === 0) return 'none';
  const run = (typeof runs[0] === 'object' && runs[0] !== null ? runs[0] : {}) as Record<string, unknown>;
  const conclusion = run.conclusion;
  const status = run.status;
  if (conclusion === 'success') return 'success';
  if (
    conclusion === 'failure' ||
    conclusion === 'timed_out' ||
    conclusion === 'cancelled' ||
    conclusion === 'startup_failure'
  ) {
    return 'failure';
  }
  if (
    conclusion === null &&
    (status === 'in_progress' || status === 'queued' || status === 'waiting' || status === 'pending')
  ) {
    return 'pending';
  }
  return 'none';
}

/** Pure. Map /releases/latest to {tag, publishedAt} or null. */
export function mapRelease(json: unknown): { tag: string; publishedAt: string } | null {
  if (typeof json !== 'object' || json === null) return null;
  const r = json as Record<string, unknown>;
  if (typeof r.tag_name !== 'string') return null;
  return { tag: r.tag_name, publishedAt: typeof r.published_at === 'string' ? r.published_at : '' };
}

/** Fetch card-level GitHub data for a repo. Four endpoints concurrently; never throws. */
export async function fetchRepoCard(coords: GitHubCoords, token?: string): Promise<RepoGitHub> {
  const base = `/repos/${coords.owner}/${coords.repo}`;
  const [meta, runs, release, pulls] = await Promise.all([
    ghJson<unknown>(base, token),
    ghJson<unknown>(`${base}/actions/runs?per_page=1`, token),
    ghJson<unknown>(`${base}/releases/latest`, token),
    ghJson<unknown[]>(`${base}/pulls?state=open&per_page=100`, token),
  ]);

  const m = mapRepoMeta(meta.data);
  const prCount = Array.isArray(pulls.data) ? pulls.data.length : 0;
  return {
    stars: m.stars,
    forks: m.forks,
    isPrivate: m.isPrivate,
    archived: m.archived,
    openIssues: Math.max(0, m.openIssuesRaw - prCount),
    prCount,
    ciStatus: mapCiStatus(runs.data),
    latestRelease: mapRelease(release.data),
    description: m.description,
    topics: m.topics,
    language: m.language,
    license: m.license,
    defaultBranch: m.defaultBranch,
    pushedAt: m.pushedAt,
    htmlUrl: m.htmlUrl,
    watchers: m.watchers,
    updatedAt: m.updatedAt,
    disabled: m.disabled,
    fork: m.fork,
    parent: m.parent,
    homepage: m.homepage,
    hasIssues: m.hasIssues,
    hasWiki: m.hasWiki,
    hasPages: m.hasPages,
    size: m.size,
  };
}
