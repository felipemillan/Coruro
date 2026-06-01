# GitHub Data on Cards & Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch GitHub data per repo with the user's PAT — card badges (CI, issues, release, stars) from a scan-time ETag-cached fetch, and a modal overview band + Files|Activity tabs (PRs/commits/issues, lazy).

**Architecture:** A DRY `ghJson` client with an in-memory ETag cache underlies all GitHub calls. Pure JSON→model mappers are unit-tested with vitest; fetchers, store enrichment, and React UI are thin wrappers verified by running the app. Card data is fetched for all repos during `scanAndDistribute`; modal activity is fetched lazily when the Activity tab opens. GitHub data is runtime-only (never persisted), nested under `repo.gh`.

**Tech Stack:** Tauri 2, React 19, TypeScript strict, Vite, vitest, `@tauri-apps/plugin-shell` (open URLs), `@tauri-apps/api/core` (`invoke('get_token')`).

**Spec:** `docs/superpowers/specs/2026-06-01-github-data-cards-modal-design.md`

---

## Model Assignment

| Task | Model | Why |
|------|-------|-----|
| 1. `types.ts` contracts | **haiku 4.5** | Small, exact, copy from spec. |
| 2. `scanner.ts` remoteUrl | **haiku 4.5** | One field added to an existing Promise.all. |
| 3. `githubClient.ts` (ETag core) | **sonnet 4.6** | Real logic (conditional cache), exact spec. |
| 4. `github.ts` mappers + fetchRepoCard + tests | **sonnet 4.6** | Pure mappers (TDD) + compose fetch. |
| 5. `githubActivity.ts` mappers + fetch + tests | **sonnet 4.6** | Pure mappers (TDD) + compose fetch. |
| 6. store enrichment wiring | **opus 4.8** | Token, concurrency pool, scan race, integration. |
| 7. `RepoCard.tsx` badges | **sonnet 4.6** | Presentational, clear spec. |
| 8. `RepoDetail.tsx` overview + tabs + activity | **opus 4.8** | Stateful UI, lazy load, layout, high blast radius. |
| 9. Integration verify (run app) | **opus 4.8** | Whole-picture, live drive. |

Tasks 3, 4, 5 touch disjoint files — parallelizable after Task 1 (Task 4 & 5 import from Task 3's `githubClient`, so 3 → {4,5}). Task 6 depends on 1,2,4. Task 7 depends on 1. Task 8 depends on 1,5. Task 9 last.

---

## File Structure

- `src/types.ts` — **modify**: `CiStatus`, `RepoGitHub`, `Repo.remoteUrl`, `Repo.gh`. *(Task 1)*
- `src/utils/scanner.ts` — **modify**: capture `remoteUrl` in `scanRepos`. *(Task 2)*
- `src/utils/githubClient.ts` — **create**: `ghJson` + ETag cache. *(Task 3)*
- `src/utils/github.ts` — **modify**: keep `parseRemote`, add mappers + `fetchRepoCard`, remove `fetchOpenPrCount`. *(Task 4)*
- `src/utils/github.test.ts` — **create**: `parseRemote` + mapper tests. *(Task 4)*
- `src/utils/githubActivity.ts` — **create**: activity types, mappers, `fetchActivity`. *(Task 5)*
- `src/utils/githubActivity.test.ts` — **create**: mapper tests. *(Task 5)*
- `src/store/useBoardStore.ts` — **modify**: `enrichGitHub` action + call from `scanAndDistribute`. *(Task 6)*
- `src/components/RepoCard.tsx` — **modify**: badges from `repo.gh`. *(Task 7)*
- `src/components/RepoDetail.tsx` — **modify**: overview band + Files|Activity tabs. *(Task 8)*

---

## Task 1: Type contracts  ·  **haiku 4.5**

**Files:** Modify `src/types.ts`

- [ ] **Step 1: Append GitHub types**

Append to `src/types.ts`:

```ts
/** Latest CI (GitHub Actions) conclusion for the default branch. */
export type CiStatus = 'success' | 'failure' | 'pending' | 'none';

/** GitHub-derived, runtime-only repo data. Recomputed on each scan. */
export interface RepoGitHub {
  stars: number;
  forks: number;
  isPrivate: boolean;
  archived: boolean;
  openIssues: number; // true issues = open_issues_count − prCount
  prCount: number;
  ciStatus: CiStatus;
  latestRelease: { tag: string; publishedAt: string } | null;
  description: string | null;
  topics: string[];
  language: string | null; // primary language
  license: string | null; // SPDX id, e.g. "MIT"
  defaultBranch: string;
  pushedAt: string; // ISO 8601
}
```

- [ ] **Step 2: Add fields to the `Repo` interface**

In `src/types.ts`, the existing `Repo` interface ends with `prCount: number;`. Add two optional fields right after it:

```ts
  /** origin remote URL captured at scan time (null when no origin). */
  remoteUrl?: string | null;
  /** GitHub enrichment; null = no github.com remote or fetch failed. */
  gh?: RepoGitHub | null;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add CiStatus, RepoGitHub, Repo.remoteUrl/gh"
```

---

## Task 2: Capture remote URL in scanner  ·  **haiku 4.5**

**Files:** Modify `src/utils/scanner.ts`

- [ ] **Step 1: Add `getRemoteUrl` to the per-repo Promise.all and return `remoteUrl`**

In `src/utils/scanRepos`'s map callback, replace this block:

```ts
        const [branch, dirty] = await Promise.all([
          getBranch(subdirPath),
          getDirty(subdirPath),
        ]);

        return {
          name: entry.name,
          path: subdirPath,
          branch,
          dirty,
          prCount: 0,
        };
```

with:

```ts
        const [branch, dirty, remoteUrl] = await Promise.all([
          getBranch(subdirPath),
          getDirty(subdirPath),
          getRemoteUrl(subdirPath),
        ]);

        return {
          name: entry.name,
          path: subdirPath,
          branch,
          dirty,
          prCount: 0,
          remoteUrl,
        };
```

(`getRemoteUrl` is already defined and exported in this file — no new import.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/utils/scanner.ts
git commit -m "feat(scanner): capture origin remoteUrl per repo"
```

---

## Task 3: GitHub client with ETag cache  ·  **sonnet 4.6**

**Files:** Create `src/utils/githubClient.ts`

Uses `fetch`, so it's verified by running the app (Task 9), not by vitest.

- [ ] **Step 1: Create `src/utils/githubClient.ts`**

```ts
// githubClient.ts — authenticated GitHub REST client with an in-memory ETag cache.
//
// One DRY core (`ghJson`) used by every GitHub fetcher. Conditional requests
// (If-None-Match) make unchanged resources return 304, which DOES NOT count
// against the rate limit — so manual rescans within a session are nearly free.
// The cache is module-level and session-lived (cleared on app restart, by design).

const API_BASE = 'https://api.github.com';

interface CacheEntry {
  etag: string;
  data: unknown;
}

const etagCache = new Map<string, CacheEntry>();

export interface GhResult<T> {
  data: T | null;
  status: number;
}

/**
 * Authenticated GET against the GitHub REST API with ETag conditional caching.
 * Never throws. `path` is appended to https://api.github.com.
 *
 *  - 200 → cache {etag,data} when an ETag header is present; return data.
 *  - 304 → return the cached data (status 304).
 *  - 404 / other non-ok → { data: null, status }.
 *  - network / parse error → { data: null, status: 0 }.
 */
export async function ghJson<T>(path: string, token?: string): Promise<GhResult<T>> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token !== undefined && token.length > 0) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const cached = etagCache.get(url);
  if (cached !== undefined) {
    headers['If-None-Match'] = cached.etag;
  }

  try {
    const response = await fetch(url, { headers });

    if (response.status === 304 && cached !== undefined) {
      return { data: cached.data as T, status: 304 };
    }
    if (!response.ok) {
      return { data: null, status: response.status };
    }

    const data = (await response.json()) as T;
    const etag = response.headers.get('ETag');
    if (etag !== null) {
      etagCache.set(url, { etag, data });
    }
    return { data, status: response.status };
  } catch {
    return { data: null, status: 0 };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/utils/githubClient.ts
git commit -m "feat(github): ghJson client with in-memory ETag cache"
```

---

## Task 4: Card fetch — mappers + fetchRepoCard + tests  ·  **sonnet 4.6**

**Files:** Modify `src/utils/github.ts`, Create `src/utils/github.test.ts`

Follow TDD for the pure functions (`parseRemote`, `mapRepoMeta`, `mapCiStatus`, `mapRelease`).

- [ ] **Step 1: Write the failing tests — create `src/utils/github.test.ts`**

```ts
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
    };
    expect(mapRepoMeta(json)).toEqual({
      stars: 12, forks: 3, isPrivate: true, archived: false,
      description: 'hi', topics: ['a', 'b'], language: 'TypeScript',
      license: 'MIT', defaultBranch: 'main',
      pushedAt: '2026-06-01T00:00:00Z', openIssuesRaw: 7,
    });
  });
  test('NOASSERTION license → null; missing fields → defaults', () => {
    const r = mapRepoMeta({ license: { spdx_id: 'NOASSERTION' } });
    expect(r.license).toBeNull();
    expect(r.stars).toBe(0);
    expect(r.topics).toEqual([]);
    expect(r.description).toBeNull();
  });
  test('non-object → all defaults', () => {
    expect(mapRepoMeta(null).stars).toBe(0);
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
```

- [ ] **Step 2: Run tests, confirm FAIL**

Run: `npm test -- src/utils/github.test.ts`
Expected: FAIL — `mapRepoMeta`/`mapCiStatus`/`mapRelease` not exported.

- [ ] **Step 3: Edit `src/utils/github.ts`**

Replace the file's import-less top doc and the `fetchOpenPrCount` function. Concretely:

(a) Keep `parseRemote` and `GitHubCoords` exactly as they are.

(b) Add this import at the very top of the file (above the existing doc comment is fine, or right after it):

```ts
import { ghJson } from './githubClient';
import type { CiStatus, RepoGitHub } from '../types';
```

(c) DELETE the entire `fetchOpenPrCount` function (from its doc comment through its closing brace).

(d) Append these exports at the end of the file:

```ts
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
  openIssuesRaw: number;
}

/** Pure. Map a /repos/{o}/{r} payload to RepoMetaSlice. Defaults on missing fields. */
export function mapRepoMeta(json: unknown): RepoMetaSlice {
  const o = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  const licObj = o.license;
  const spdx =
    typeof licObj === 'object' && licObj !== null && typeof (licObj as Record<string, unknown>).spdx_id === 'string'
      ? ((licObj as Record<string, unknown>).spdx_id as string)
      : null;
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
    openIssuesRaw: typeof o.open_issues_count === 'number' ? o.open_issues_count : 0,
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
  };
}
```

- [ ] **Step 4: Run tests, confirm PASS**

Run: `npm test -- src/utils/github.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Typecheck (catches any leftover `fetchOpenPrCount` importers)**

Run: `npx tsc --noEmit`
Expected: exit 0. (If a compile error reports `fetchOpenPrCount` is still imported somewhere, that import was already dead — remove it; the only place it could appear is nowhere, since the store never wired it.)

- [ ] **Step 6: Commit**

```bash
git add src/utils/github.ts src/utils/github.test.ts
git commit -m "feat(github): repo-card mappers + fetchRepoCard + parseRemote tests"
```

---

## Task 5: Activity fetch — mappers + fetchActivity + tests  ·  **sonnet 4.6**

**Files:** Create `src/utils/githubActivity.ts`, Create `src/utils/githubActivity.test.ts`

- [ ] **Step 1: Write the failing tests — create `src/utils/githubActivity.test.ts`**

```ts
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
```

- [ ] **Step 2: Run tests, confirm FAIL**

Run: `npm test -- src/utils/githubActivity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/utils/githubActivity.ts`**

```ts
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
    const user = (typeof o.user === 'object' && o.user !== null ? o.user : {}) as Record<string, unknown>;
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
    const commit = (typeof o.commit === 'object' && o.commit !== null ? o.commit : {}) as Record<string, unknown>;
    const author = (typeof commit.author === 'object' && commit.author !== null ? commit.author : {}) as Record<string, unknown>;
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

/** Fetch modal activity (PRs, commits, issues) concurrently. Each failure → empty array. */
export async function fetchActivity(coords: GitHubCoords, token?: string): Promise<GhActivity> {
  const base = `/repos/${coords.owner}/${coords.repo}`;
  const [pulls, commits, issues] = await Promise.all([
    ghJson<unknown>(`${base}/pulls?state=open&per_page=20`, token),
    ghJson<unknown>(`${base}/commits?per_page=10`, token),
    ghJson<unknown>(`${base}/issues?state=open&per_page=20`, token),
  ]);
  return {
    prs: mapPulls(pulls.data),
    commits: mapCommits(commits.data),
    issues: mapIssues(issues.data),
  };
}
```

- [ ] **Step 4: Run tests, confirm PASS**

Run: `npm test -- src/utils/githubActivity.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/utils/githubActivity.ts src/utils/githubActivity.test.ts
git commit -m "feat(github): activity mappers + fetchActivity + tests"
```

---

## Task 6: Store GitHub enrichment  ·  **opus 4.8**

**Files:** Modify `src/store/useBoardStore.ts`

Verified by running the app (Task 9).

- [ ] **Step 1: Add imports**

In `src/store/useBoardStore.ts`, the existing import of scanner is:
```ts
import { scanRepos } from '../utils/scanner';
```
Add right after it:
```ts
import { parseRemote, fetchRepoCard } from '../utils/github';
import type { RepoGitHub } from '../types';
```
(`RepoGitHub` can be merged into the existing `../types` import instead — either is fine; keep `import type`.)

- [ ] **Step 2: Declare the action in the `BoardStore` interface**

Add to the `BoardStore` interface (near `scanAndDistribute`):
```ts
  /**
   * Enrich the current runtime repos with GitHub data (badges/overview).
   * Runtime-only; never persisted. Safe to fire-and-forget after a scan.
   */
  enrichGitHub: () => Promise<void>;
```

- [ ] **Step 3: Implement `enrichGitHub` in the store object**

Add this method to the store (e.g. right after `scanAndDistribute`):
```ts
  enrichGitHub: async () => {
    const targets = get().repos.filter(
      (r) => typeof r.remoteUrl === 'string' && parseRemote(r.remoteUrl) !== null,
    );
    if (targets.length === 0) return;

    // Transient token (never stored in JS state); unauthenticated if absent.
    const token = await invoke<string | null>('get_token').catch(() => null);

    // Bounded-concurrency pool so a large root can't fire hundreds of requests.
    const CONCURRENCY = 6;
    const ghByPath = new Map<string, RepoGitHub>();
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < targets.length) {
        const repo = targets[cursor];
        cursor += 1;
        const coords = parseRemote(repo.remoteUrl as string);
        if (coords === null) continue;
        try {
          ghByPath.set(repo.path, await fetchRepoCard(coords, token ?? undefined));
        } catch {
          // Per-repo failure: leave gh null for this repo.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()),
    );

    // Merge by path against the LATEST repo list (a newer scan may have run).
    set((s) => ({
      repos: s.repos.map((r) => ({ ...r, gh: ghByPath.get(r.path) ?? null })),
    }));
  },
```

- [ ] **Step 4: Call enrichment at the end of `scanAndDistribute`**

In `scanAndDistribute`, the final line is `await get().save();`. Add immediately after it:
```ts
    // Fire-and-forget GitHub enrichment: the board renders now; badges fill in
    // when the fetches resolve. Failures degrade to gh:null per repo.
    void get().enrichGitHub();
```

- [ ] **Step 5: Typecheck + existing tests still green**

Run: `npx tsc --noEmit && npm test`
Expected: tsc exit 0; all prior vitest pass (no store unit tests; pure-fn suites unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/store/useBoardStore.ts
git commit -m "feat(store): GitHub enrichment pass after scan (bounded concurrency)"
```

---

## Task 7: Card badges  ·  **sonnet 4.6**

**Files:** Modify `src/components/RepoCard.tsx`

- [ ] **Step 1: Replace `src/components/RepoCard.tsx` with the badge-enabled version**

```tsx
// RepoCard.tsx — Kanban card for a single repository.
//
// Displays: repo name, current branch, dirty/clean badge, GitHub badges
// (CI status, open issues, stars, latest release, private/archived), and
// three icon buttons (detail modal, editor, Finder). Notes live in the
// detail modal's timeline.
//
// Design contract: rounded-none, indie pastel / Wes Anderson palette.
// Arg arrays only — no shell string interpolation.

import { useState } from 'react';
import { Code2, FolderOpen, FileText, Star, CircleDot, Tag } from 'lucide-react';
import { Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { useBoardStore } from '../store/useBoardStore';
import { RepoDetail } from './RepoDetail';
import type { Repo, CiStatus } from '../types';

interface RepoCardProps {
  repo: Repo;
}

/** Compact relative age like "3d" / "5h" / "2w" from an ISO timestamp. */
function relativeAge(iso: string): string {
  if (iso === '') return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.max(0, (Date.now() - then) / 1000);
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d`;
  if (sec < 2629800) return `${Math.floor(sec / 604800)}w`;
  return `${Math.floor(sec / 2629800)}mo`;
}

/** Tailwind text color for a CI dot. Returns null when no CI to show. */
function ciColor(status: CiStatus): string | null {
  switch (status) {
    case 'success': return 'text-sage';
    case 'failure': return 'text-terracotta';
    case 'pending': return 'text-amber-500';
    case 'none': return null;
  }
}

export function RepoCard({ repo }: RepoCardProps) {
  const editorCommand = useBoardStore((s) => s.settings.editorCommand);
  const editorApp = useBoardStore((s) => s.settings.editorApp);

  const [detailOpen, setDetailOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  async function openInEditor() {
    setOpenError(null);
    try {
      await invoke('open_in_editor', {
        command: editorCommand,
        app: editorApp,
        path: repo.path,
      });
    } catch (e: unknown) {
      setOpenError(e instanceof Error ? e.message : String(e));
    }
  }

  async function revealInFinder() {
    await Command.create('open', ['--', repo.path]).execute();
  }

  const gh = repo.gh ?? null;
  const ci = gh ? ciColor(gh.ciStatus) : null;

  return (
    <article
      className="bg-warm-gray border border-navy/10 p-3 flex flex-col gap-2 shadow-sm"
      data-path={repo.path}
    >
      {/* ── Header row: name + action buttons ── */}
      <div className="flex items-start justify-between gap-2">
        <h3
          className="text-navy font-semibold text-sm leading-tight break-all"
          title={repo.path}
        >
          {repo.name}
        </h3>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="p-1 text-navy-light hover:text-sage transition-colors"
            title="View README & files"
            aria-label="View README and files"
          >
            <FileText size={14} strokeWidth={1.75} />
          </button>

          <button
            type="button"
            onClick={() => { void openInEditor(); }}
            className="p-1 text-navy-light hover:text-sage transition-colors"
            title={`Open in editor (${editorCommand || editorApp})`}
            aria-label="Open in editor"
          >
            <Code2 size={14} strokeWidth={1.75} />
          </button>

          <button
            type="button"
            onClick={() => { void revealInFinder(); }}
            className="p-1 text-navy-light hover:text-sage transition-colors"
            title="Reveal in Finder"
            aria-label="Reveal in Finder"
          >
            <FolderOpen size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Editor-launch error */}
      {openError !== null && (
        <p className="text-[11px] text-terracotta leading-snug" role="alert">
          {openError}
        </p>
      )}

      {detailOpen && (
        <RepoDetail repo={repo} onClose={() => setDetailOpen(false)} />
      )}

      {/* ── Meta row: branch + dirty badge ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-navy-light text-xs font-mono truncate max-w-[120px]">
          {repo.branch}
        </span>

        <span
          className={[
            'text-xs px-1.5 py-0.5 font-medium leading-none',
            repo.dirty ? 'bg-terracotta/20 text-terracotta' : 'bg-sage/20 text-sage',
          ].join(' ')}
          aria-label={repo.dirty ? 'Uncommitted changes' : 'Working tree clean'}
        >
          {repo.dirty ? 'dirty' : 'clean'}
        </span>

        {gh?.isPrivate && (
          <span className="text-xs px-1.5 py-0.5 bg-navy/10 text-navy-light font-medium leading-none">
            private
          </span>
        )}
        {gh?.archived && (
          <span className="text-xs px-1.5 py-0.5 bg-navy/10 text-navy-light font-medium leading-none">
            archived
          </span>
        )}
      </div>

      {/* ── GitHub badges row (only when enriched) ── */}
      {gh && (
        <div className="flex items-center gap-3 flex-wrap text-[11px] text-navy-light">
          {ci !== null && (
            <span className={`flex items-center gap-1 ${ci}`} title={`CI: ${gh.ciStatus}`}>
              <CircleDot size={11} strokeWidth={2} />
              CI
            </span>
          )}
          {gh.prCount > 0 && (
            <span className="px-1.5 py-0.5 bg-dusty-pink/30 text-navy-light font-medium leading-none">
              {gh.prCount} PR{gh.prCount === 1 ? '' : 's'}
            </span>
          )}
          {gh.openIssues > 0 && (
            <span title="Open issues">
              {gh.openIssues} issue{gh.openIssues === 1 ? '' : 's'}
            </span>
          )}
          {gh.stars > 0 && (
            <span className="flex items-center gap-0.5" title="Stars">
              <Star size={11} strokeWidth={1.75} /> {gh.stars}
            </span>
          )}
          {gh.latestRelease && (
            <span className="flex items-center gap-1 font-mono" title={`Latest release ${gh.latestRelease.tag}`}>
              <Tag size={11} strokeWidth={1.75} />
              {gh.latestRelease.tag}
              {relativeAge(gh.latestRelease.publishedAt) && ` · ${relativeAge(gh.latestRelease.publishedAt)}`}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc exit 0; build succeeds. (If `amber-500` is not in the Tailwind palette, the class is simply inert — acceptable; the dot still renders via the icon. Leave as-is.)

- [ ] **Step 3: Commit**

```bash
git add src/components/RepoCard.tsx
git commit -m "feat(card): GitHub badges (CI, PRs, issues, stars, release, flags)"
```

---

## Task 8: Modal overview band + Files|Activity tabs  ·  **opus 4.8**

**Files:** Modify `src/components/RepoDetail.tsx`

Verified by running the app (Task 9). Integrate the following edits into the existing component (current head: the post-fix version with functional-update `persist`).

- [ ] **Step 1: Extend imports**

Add to the lucide import list (alongside the existing icons): `GitPullRequest`, `GitCommit`, `CircleDot`, `ExternalLink`, `Tag`.

Add these imports after the existing `notesTimeline` import block:
```ts
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { parseRemote } from '../utils/github';
import { fetchActivity, type GhActivity } from '../utils/githubActivity';
```
Add `CiStatus` to the existing `../types` import.

- [ ] **Step 2: Add tab + activity state (inside the component, with the other useState hooks)**

```ts
  const [tab, setTab] = useState<'files' | 'activity'>('files');
  const [activity, setActivity] = useState<GhActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
```

- [ ] **Step 3: Add a lazy activity loader effect (after the existing effects)**

```ts
  // Lazily fetch PRs/commits/issues the first time the Activity tab opens.
  useEffect(() => {
    if (tab !== 'activity' || activity !== null || activityLoading) return;
    const coords = repo.remoteUrl ? parseRemote(repo.remoteUrl) : null;
    if (coords === null) {
      setActivity({ prs: [], commits: [], issues: [] });
      return;
    }
    let cancelled = false;
    setActivityLoading(true);
    setActivityError(null);
    (async () => {
      try {
        const token = await invoke<string | null>('get_token').catch(() => null);
        const result = await fetchActivity(coords, token ?? undefined);
        if (!cancelled) setActivity(result);
      } catch (e: unknown) {
        if (!cancelled) setActivityError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, activity, activityLoading, repo.remoteUrl]);

  // Reset tab + activity when switching repos.
  useEffect(() => {
    setTab('files');
    setActivity(null);
    setActivityError(null);
  }, [repo.path]);

  const openUrl = useCallback((url: string) => {
    if (url) void openExternal(url);
  }, []);
```

- [ ] **Step 4: Insert the overview band between the modal header and the body row**

Find this exact anchor (the modal header's closing `</div>` followed by the body comment):
```tsx
        {/* Body: md tree | (preview / timeline) */}
        <div className="flex flex-1 min-h-0">
```
Replace it with the overview band + the same body opener:
```tsx
        {/* GitHub overview band */}
        <div className="shrink-0 px-5 py-2.5 bg-cream/60 border-b border-warm-gray text-[12px] text-navy-light flex items-center gap-3 flex-wrap min-h-[40px]">
          {repo.gh ? (
            <>
              {repo.gh.description && (
                <span className="text-navy truncate max-w-[40%]">{repo.gh.description}</span>
              )}
              {repo.gh.language && <span className="font-mono">{repo.gh.language}</span>}
              {repo.gh.license && <span className="font-mono">{repo.gh.license}</span>}
              <span className="flex items-center gap-1"><Star size={12} strokeWidth={1.75} />{repo.gh.stars}</span>
              <span className="font-mono">⑂ {repo.gh.forks}</span>
              <span title="Open issues">{repo.gh.openIssues} issues</span>
              <span title="Open PRs">{repo.gh.prCount} PRs</span>
              {repo.gh.ciStatus !== 'none' && (
                <span
                  className={
                    repo.gh.ciStatus === 'success'
                      ? 'text-sage flex items-center gap-1'
                      : repo.gh.ciStatus === 'failure'
                        ? 'text-terracotta flex items-center gap-1'
                        : 'text-amber-500 flex items-center gap-1'
                  }
                >
                  <CircleDot size={12} strokeWidth={2} />CI {repo.gh.ciStatus}
                </span>
              )}
              {repo.gh.latestRelease && (
                <span className="flex items-center gap-1 font-mono">
                  <Tag size={12} strokeWidth={1.75} />{repo.gh.latestRelease.tag}
                </span>
              )}
              {repo.gh.topics.length > 0 && (
                <span className="flex items-center gap-1 flex-wrap">
                  {repo.gh.topics.slice(0, 5).map((t) => (
                    <span key={t} className="px-1.5 py-0.5 bg-sage/15 text-sage text-[10px] font-mono">{t}</span>
                  ))}
                </span>
              )}
            </>
          ) : (
            <span className="italic text-navy-light/50">No GitHub data (local-only or no github.com remote).</span>
          )}
        </div>

        {/* Body: md tree / activity | (preview / timeline) */}
        <div className="flex flex-1 min-h-0">
```
(Requires `Star` in the lucide import — add it.)

- [ ] **Step 5: Replace the left `<aside>` (tree pane) with a tabbed Files/Activity pane**

Find the entire existing `<aside …> … </aside>` block (the markdown tree pane, header "Markdown" + the tree list) and replace it with:
```tsx
          {/* Left pane: Files | Activity tabs */}
          <aside className="w-[280px] shrink-0 border-r border-warm-gray bg-cream/60 flex flex-col min-h-0">
            {/* Tab bar */}
            <div className="shrink-0 flex border-b border-warm-gray">
              <button
                type="button"
                onClick={() => setTab('files')}
                className={`flex-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest transition-colors cursor-pointer ${
                  tab === 'files' ? 'text-navy bg-cream' : 'text-navy-light/60 hover:text-navy'
                }`}
              >
                Files{tree && <span className="ml-1.5 font-mono normal-case tracking-normal text-navy-light/40">{tree.total}{tree.truncated ? '+' : ''}</span>}
              </button>
              <button
                type="button"
                onClick={() => setTab('activity')}
                className={`flex-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest transition-colors cursor-pointer ${
                  tab === 'activity' ? 'text-navy bg-cream' : 'text-navy-light/60 hover:text-navy'
                }`}
              >
                Activity
              </button>
            </div>

            {/* Tab body */}
            <div className="flex-1 overflow-auto py-1 min-h-0">
              {tab === 'files' ? (
                loading ? (
                  <p className="px-3 py-2 text-[12px] text-navy-light/50">Loading…</p>
                ) : tree && tree.root.length > 0 ? (
                  <>
                    {tree.root.map((node) => (
                      <TreeRow
                        key={node.path}
                        node={node}
                        depth={0}
                        expanded={expanded}
                        toggle={toggle}
                        selectedPath={selected?.path ?? null}
                        onSelect={onSelect}
                      />
                    ))}
                    {tree.truncated && (
                      <p className="px-3 py-2 mt-1 text-[11px] text-terracotta">
                        Tree truncated at the entry cap — large repo.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="px-3 py-2 text-[12px] text-navy-light/50 italic">No markdown files.</p>
                )
              ) : (
                <ActivityPane
                  activity={activity}
                  loading={activityLoading}
                  error={activityError}
                  hasRemote={repo.remoteUrl ? parseRemote(repo.remoteUrl) !== null : false}
                  onOpen={openUrl}
                />
              )}
            </div>
          </aside>
```

- [ ] **Step 6: Add the `ActivityPane` sub-component (above the main `RepoDetail` component, near `TreeRow`)**

```tsx
function ActivityPane({
  activity,
  loading,
  error,
  hasRemote,
  onOpen,
}: {
  activity: GhActivity | null;
  loading: boolean;
  error: string | null;
  hasRemote: boolean;
  onOpen: (url: string) => void;
}) {
  if (!hasRemote) {
    return <p className="px-3 py-2 text-[12px] text-navy-light/50 italic">No github.com remote.</p>;
  }
  if (loading) return <p className="px-3 py-2 text-[12px] text-navy-light/50">Loading activity…</p>;
  if (error !== null) return <p className="px-3 py-2 text-[12px] text-terracotta font-mono">{error}</p>;
  if (activity === null) return null;

  const Row = ({ url, children }: { url: string; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={() => onOpen(url)}
      className="flex items-start gap-1.5 w-full px-3 py-1.5 text-left text-[12px] text-navy-light hover:bg-warm-gray transition-colors cursor-pointer"
      title={url}
    >
      <ExternalLink size={10} strokeWidth={1.5} className="shrink-0 mt-0.5 text-navy-light/40" />
      <span className="truncate">{children}</span>
    </button>
  );

  const Heading = ({ children }: { children: React.ReactNode }) => (
    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-navy-light/50 select-none">
      {children}
    </div>
  );

  const empty = activity.prs.length === 0 && activity.commits.length === 0 && activity.issues.length === 0;
  if (empty) return <p className="px-3 py-2 text-[12px] text-navy-light/50 italic">No recent activity.</p>;

  return (
    <div className="flex flex-col gap-2 pb-2">
      {activity.prs.length > 0 && (
        <section>
          <Heading><GitPullRequest size={10} strokeWidth={1.5} className="inline mr-1" />Open PRs</Heading>
          {activity.prs.map((p) => (
            <Row key={p.number} url={p.url}>
              <span className="font-mono text-navy-light/50">#{p.number}</span> {p.title}
              {p.draft && <span className="ml-1 text-[10px] text-navy-light/40">(draft)</span>}
            </Row>
          ))}
        </section>
      )}
      {activity.commits.length > 0 && (
        <section>
          <Heading><GitCommit size={10} strokeWidth={1.5} className="inline mr-1" />Recent commits</Heading>
          {activity.commits.map((c) => (
            <Row key={c.sha} url={c.url}>
              {c.message} <span className="text-navy-light/40">· {c.author}</span>
            </Row>
          ))}
        </section>
      )}
      {activity.issues.length > 0 && (
        <section>
          <Heading><CircleDot size={10} strokeWidth={1.5} className="inline mr-1" />Recent issues</Heading>
          {activity.issues.map((i) => (
            <Row key={i.number} url={i.url}>
              <span className="font-mono text-navy-light/50">#{i.number}</span> {i.title}
            </Row>
          ))}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc exit 0; build succeeds. Resolve any unused-import errors by ensuring every newly imported icon (`Star`, `GitPullRequest`, `GitCommit`, `CircleDot`, `ExternalLink`, `Tag`) is actually used (they are, per the code above) and that `CiStatus` is imported if referenced. If `CiStatus` ends up unused after integration, drop it from the import.

- [ ] **Step 8: Commit**

```bash
git add src/components/RepoDetail.tsx
git commit -m "feat(detail): GitHub overview band + Files|Activity tabs"
```

---

## Task 9: Integration verify  ·  **opus 4.8**

**Files:** none (verification only)

App launch + screenshot recipe: `npm run tauri dev`, then probe `screencapture -x -D <n>` per display (window location varies; no Quartz/accessibility — see project memory).

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc 0; all vitest green (github + githubActivity + prior suites); build succeeds.

- [ ] **Step 2: Launch (or rely on the already-running dev server's HMR)**

If not running: `npm run tauri dev`; wait for `` Running `target/debug/tauri-app` ``.

- [ ] **Step 3: Verify card badges**

Ensure a GitHub PAT is saved (Settings) and trigger a rescan (Settings → Rescan now). Screenshot the board and read it.
Expected: cards for repos with github.com remotes show badges (CI dot, PRs/issues counts, ★stars, release tag) once enrichment resolves; local-only repos show no badges.

- [ ] **Step 4: Verify overview band + Files/Activity tabs**

Open a repo's detail. Screenshot.
Expected: overview band under the header shows description/language/license/stars/forks/issues/PRs/CI/release/topics (or the muted "No GitHub data" note for local-only). Left pane shows `Files | Activity` tabs; Files = markdown tree.

- [ ] **Step 5: Verify Activity tab lazy load**

Click the Activity tab. Screenshot.
Expected: shows Open PRs / Recent commits / Recent issues lists (or "No recent activity"). Clicking a row opens the URL in the browser.

- [ ] **Step 6: Verify rate-limit friendliness**

Rescan a second time. Enrichment should feel instant for unchanged repos (ETag 304s served from cache). No errors in the dev console/log.

- [ ] **Step 7: Commit any fixes**

If Steps 1–6 surfaced bugs, fix the smallest change, re-run Step 1, and commit:
```bash
git add -A
git commit -m "fix(github): address integration findings"
```

---

## Notes for the executor

- **Concurrency:** Tasks 3,4,5 are disjoint files (4 & 5 import Task 3). Task 1 first (contracts), then 2/3, then 4/5, then 6, then 7/8, then 9.
- **Style:** match existing Tailwind tokens (`cream`, `sage`, `terracotta`, `navy`, `navy-light`, `warm-gray`, `dusty-pink`). `amber-500` is the one default-Tailwind color used for the pending CI state — if it's absent from the v4 config it renders inert, acceptable.
- **Token:** never store the raw PAT in React/zustand state — only pass it as a transient argument to fetchers, mirroring `refreshHasToken`.
- **YAGNI:** no security alerts, no background polling, no ahead/behind, no persistence of `gh`/ETags.
- **Back-compat:** leave the legacy top-level `Repo.prCount` (scanner sets 0); the card reads `gh.prCount`.
