# Design — GitHub data on cards & modal

**Date:** 2026-06-01
**Status:** Approved (design), pending implementation plan
**Area:** `src/types.ts`, `src/utils/scanner.ts`, `src/utils/github.ts`, new `src/utils/githubClient.ts`, new `src/utils/githubActivity.ts`, `src/store/useBoardStore.ts`, `src/components/RepoCard.tsx`, `src/components/RepoDetail.tsx`

## Goal

Surface GitHub data per repo using the user's PAT. Card badges (glanceable) + modal depth (rich). Activates GitHub fetching — currently `github.ts` is dead code and `repo.prCount` is always 0 (enrichment was never wired into the store).

## Decisions (from brainstorming)

- **Card badges:** CI status, true open-issue count, latest release, stars + private/archived flags.
- **Modal data:** repo overview (description/topics/language/license/stars/forks/default branch/pushed), open PRs list, recent commits, recent issues.
- **Fetch strategy:** on dir-scan + manual rescan only. In-memory ETag cache (304s don't count against rate limit). No background polling.
- **Security data (Dependabot/code-scanning):** out of scope — keeps PAT scope minimal (`repo`).
- **Token:** fetched transiently per enrichment via `invoke('get_token')` (same call `refreshHasToken` already uses); never stored in JS state.

## Data model — `src/types.ts`

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
  language: string | null;
  license: string | null; // SPDX id, e.g. "MIT"
  defaultBranch: string;
  pushedAt: string; // ISO 8601
}
```

`Repo` gains two optional runtime fields:

```ts
  remoteUrl?: string | null;   // origin URL captured at scan time
  gh?: RepoGitHub | null;      // null = no github.com remote OR fetch failed
```

Existing top-level `prCount` is superseded by `gh.prCount`; leave the field on `Repo` for back-compat this pass (it stays 0 from the scanner), and have `RepoCard` read `gh.prCount`.

Modal-lazy activity types (live in `githubActivity.ts`, re-exported as needed):

```ts
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
```

## Fetch layer

### `src/utils/githubClient.ts` (new)

A single DRY core for authenticated GitHub REST calls with conditional caching.

- Module-level `const etagCache = new Map<string, { etag: string; data: unknown }>()` (in-memory, session-lived).
- `export async function ghJson<T>(path: string, token?: string): Promise<{ data: T | null; status: number }>`
  - `path` is appended to `https://api.github.com`.
  - Headers: `Accept: application/vnd.github+json`; `Authorization: Bearer <token>` when token present; `If-None-Match: <etag>` when cached.
  - `304` → return cached `data` (status 304). `200` → store `{etag,data}` if an `ETag` header is present, return data. `404` / non-ok → `{ data: null, status }`. Network/parse error → `{ data: null, status: 0 }`.
  - Never throws.

### `src/utils/github.ts` (extend)

- Keep `parseRemote` unchanged; **add unit tests** for it (SSH/HTTPS/userinfo/.git/trailing-slash/non-github → null).
- Pure mappers (unit-tested), each takes parsed JSON (typed as `unknown`, narrowed) and returns the slice:
  - `mapRepoMeta(json): Pick<RepoGitHub,'stars'|'forks'|'isPrivate'|'archived'|'description'|'topics'|'language'|'license'|'defaultBranch'|'pushedAt'> & { openIssuesRaw: number }`
  - `mapCiStatus(runsJson): CiStatus` — reads `workflow_runs[0]`; map `conclusion` (`success`→success, `failure`/`timed_out`/`cancelled`→failure) or `status` in-progress/queued→pending; empty→none.
  - `mapRelease(json): { tag: string; publishedAt: string } | null` — from `tag_name`/`published_at`; null when 404.
- `export async function fetchRepoCard(coords, token?): Promise<RepoGitHub>` — composes:
  - `ghJson('/repos/{o}/{r}')`, `ghJson('/repos/{o}/{r}/actions/runs?per_page=1')`, `ghJson('/repos/{o}/{r}/releases/latest')`, `ghJson('/repos/{o}/{r}/pulls?state=open&per_page=100')`.
  - `prCount = pulls.length`; `openIssues = max(0, openIssuesRaw − prCount)` (the REST `open_issues_count` includes PRs).
  - All four run concurrently (`Promise.all`). Missing pieces degrade to defaults (ciStatus 'none', release null, counts 0).
- The existing `fetchOpenPrCount` is removed (superseded by `fetchRepoCard`); nothing else imports it.

### `src/utils/githubActivity.ts` (new)

Modal-lazy fetchers + pure mappers (unit-tested):

- `mapPulls(json): GhPull[]`, `mapCommits(json): GhCommit[]`, `mapIssues(json): GhIssue[]` (filter out entries with a `pull_request` field — the issues endpoint returns PRs too).
- `export async function fetchActivity(coords, token?): Promise<GhActivity>` — `Promise.all` of `/pulls?state=open&per_page=20`, `/commits?per_page=10`, `/issues?state=open&per_page=20`. Each failure → empty array.

## Scan integration

### `src/utils/scanner.ts`

In `scanRepos`, also capture the origin URL: call `getRemoteUrl(subdirPath)` alongside branch/dirty and set `remoteUrl` on the returned `Repo`. Keep `prCount: 0` and leave `gh` undefined here (the store enriches).

### `src/store/useBoardStore.ts`

Add a GitHub enrichment pass to `scanAndDistribute`, after notes hydration and board distribution:

1. `const token = await invoke<string|null>('get_token').catch(() => null)`.
2. For each repo whose `remoteUrl` yields `parseRemote() !== null`, call `fetchRepoCard(coords, token ?? undefined)`. Run with a **concurrency cap** (e.g. 6 at a time) so a large root doesn't fire hundreds of requests at once.
3. Merge results: `setRepos(repos.map(r => ({ ...r, gh: result.get(r.path) ?? null })))`. Repos with no github remote get `gh: null`.
4. Enrichment failure for one repo → that repo's `gh` stays null; never aborts the scan. Network/token errors are swallowed (badges simply absent).
5. Enrichment is **not** persisted (runtime only), consistent with the existing `repos` handling.

Expose this as part of `scanAndDistribute` (no separate public action needed). The board renders immediately after the local scan; `gh` data fills in when enrichment resolves (a second `setRepos`).

## Components

### `src/components/RepoCard.tsx`

Render badges from `repo.gh` (all hidden when `gh` is null):

- CI dot: 🟢 success / 🔴 failure / 🟡 pending / (hidden) none — small colored dot + `aria-label`.
- `{openIssues} issues` when > 0.
- `★{stars}` when > 0.
- Latest release: `{tag} · {relativeAge}` when present.
- Private/archived: a small `private` / `archived` tag.
  Keep the existing branch + dirty badge. Badges sit in the meta row; wrap gracefully. Match existing token palette (sage/terracotta/navy/dusty-pink).

### `src/components/RepoDetail.tsx`

Two additions, preview + timeline otherwise unchanged:

1. **Overview band** — full-width strip directly under the modal header. Reads instantly from `repo.gh` (no fetch): `description`, topic chips, `language · license · ★stars · ⑂forks`, CI status, latest release, true open-issue + PR counts. When `gh` is null, show a muted "No GitHub data (local-only or no remote)".

2. **Left-pane tabs** — `[Files] [Activity]`:
   - **Files:** the existing markdown tree (unchanged).
   - **Activity:** three compact lists — Open PRs (`#num title`, draft tag), Recent commits (message, author, short date), Recent issues (`#num title`, label chips). Each row opens its `url` in the browser via `@tauri-apps/plugin-shell` `open`. Lazy-fetched via `fetchActivity` on first switch to the Activity tab; loading + error + empty states. Token reused via `invoke('get_token')`.

## Error handling

- No token → unauthenticated requests (60/hr). Badges still attempt; on 403/rate-limit the affected `gh`/activity stays null/empty silently.
- Non-github.com remotes and local-only repos → `gh: null`, no badges, modal shows the muted overview note.
- Corrupt/unexpected JSON → mappers return safe defaults; `ghJson` never throws.
- ETag 304 responses serve cached data and don't count against the rate limit, making manual rescans nearly free within a session.

## Testing

- Pure mappers (`mapRepoMeta`, `mapCiStatus`, `mapRelease`, `mapPulls`, `mapCommits`, `mapIssues`) + `parseRemote` → vitest unit tests with representative JSON fixtures.
- `ghJson`, `fetchRepoCard`, `fetchActivity`, store enrichment, and components → verified by running the app (Tauri fetch + IPC), per project convention.

## Out of scope (YAGNI)

- Dependabot / code-scanning / security alerts.
- Background interval polling; ahead/behind vs origin; traffic stats.
- Persisting `gh` data or ETags across cold starts (session-only cache).
- Removing the legacy top-level `Repo.prCount` field (separate cleanup).

## Open risks

1. Large roots (many repos × 4 calls) can approach the unauth 60/hr limit when no token is set — the concurrency cap + ETag cache mitigate; with a token (5000/hr) it is a non-issue.
2. `actions/runs` returns nothing for repos without workflows → `ciStatus: 'none'` (badge hidden), which is correct.
3. `get_token` exposing the raw token to JS is already the established pattern (`refreshHasToken`); enrichment keeps it in a local variable for the duration of the fetch only.
