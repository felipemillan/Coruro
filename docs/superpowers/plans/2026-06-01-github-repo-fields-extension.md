# Extended /repos Fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Surface the remaining `/repos` fields (watchers, updated_at, disabled, fork, parent, homepage, has_issues/wiki/pages, size) on cards + the modal overview band — zero extra API cost.

**Architecture:** Extend the existing `RepoGitHub` model + `mapRepoMeta` pure mapper (unit-tested) + `fetchRepoCard` passthrough; render new badges on `RepoCard` and new metadata in the `RepoDetail` overview band.

**Tech Stack:** React 19, TS strict, Tailwind v4, vitest, `@tauri-apps/plugin-shell`.

**Spec:** `docs/superpowers/specs/2026-06-01-github-repo-fields-extension-design.md`

---

## Model Assignment

| Task | Model | Why |
|------|-------|-----|
| 1. `types.ts` extend `RepoGitHub` | **haiku 4.5** | Mechanical field additions. |
| 2. `github.ts` mapper + fetchRepoCard + test | **sonnet 4.6** | Pure mapper logic + test update. |
| 3. `RepoCard.tsx` new badges | **sonnet 4.6** | Presentational + a staleness helper. |
| 4. `RepoDetail.tsx` overview additions | **sonnet 4.6** | Additive overview-band JSX. |
| 5. Integration verify | **opus 4.8** | Whole-picture, live drive. |

Sequential: 1 → 2 → {3,4} → 5.

---

## Task 1: Extend RepoGitHub  ·  **haiku 4.5**

**Files:** Modify `src/types.ts`

- [ ] **Step 1: Add fields to the `RepoGitHub` interface**

In `src/types.ts`, the `RepoGitHub` interface currently ends with `pushedAt: string;`. Add these fields right before the closing `}`:

```ts
  watchers: number; // subscribers_count
  updatedAt: string; // updated_at (ISO 8601)
  disabled: boolean;
  fork: boolean;
  parent: { fullName: string; url: string } | null; // upstream; null unless a fork
  homepage: string | null;
  hasIssues: boolean;
  hasWiki: boolean;
  hasPages: boolean;
  size: number; // KB, as GitHub reports
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAILS — `fetchRepoCard` in `github.ts` no longer satisfies `RepoGitHub` (missing the new fields). This is expected; Task 2 fixes it. Note the error and proceed.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): extend RepoGitHub with watchers/fork/parent/homepage/etc"
```

(Committing a momentarily-red type is acceptable here because Task 2 lands immediately next and is part of the same feature; the working tree is a feature branch.)

---

## Task 2: Map + fetch new fields  ·  **sonnet 4.6**

**Files:** Modify `src/utils/github.ts`, Modify `src/utils/github.test.ts`

- [ ] **Step 1: Update the `mapRepoMeta` test first (TDD)**

In `src/utils/github.test.ts`, replace the existing `describe('mapRepoMeta', …)` block with:

```ts
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
```

- [ ] **Step 2: Run test, confirm FAIL**

Run: `npm test -- src/utils/github.test.ts`
Expected: FAIL — new fields missing from `mapRepoMeta` output / `RepoMetaSlice`.

- [ ] **Step 3: Extend `RepoMetaSlice` and `mapRepoMeta` in `src/utils/github.ts`**

Add these fields to the `RepoMetaSlice` interface (after `openIssuesRaw: number;`):

```ts
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
```

In `mapRepoMeta`, add the parent parse before the `return`, and the new fields to the returned object:

```ts
  const parentObj = o.parent;
  const parent =
    typeof parentObj === 'object' && parentObj !== null && typeof (parentObj as Record<string, unknown>).full_name === 'string'
      ? {
          fullName: (parentObj as Record<string, unknown>).full_name as string,
          url: typeof (parentObj as Record<string, unknown>).html_url === 'string'
            ? ((parentObj as Record<string, unknown>).html_url as string)
            : '',
        }
      : null;
  const homepageRaw = o.homepage;
  const homepage = typeof homepageRaw === 'string' && homepageRaw.length > 0 ? homepageRaw : null;
```

Then add to the returned object (alongside the existing fields):

```ts
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
```

- [ ] **Step 4: Pass the new fields through `fetchRepoCard`**

In `fetchRepoCard`, the returned object currently spreads explicit fields from `m`. Add the new ones to the returned `RepoGitHub` object:

```ts
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
```

- [ ] **Step 5: Run test + typecheck**

Run: `npm test -- src/utils/github.test.ts && npx tsc --noEmit`
Expected: tests PASS; tsc exit 0 (the Task-1 type error is now resolved).

- [ ] **Step 6: Commit**

```bash
git add src/utils/github.ts src/utils/github.test.ts
git commit -m "feat(github): map watchers/fork/parent/homepage/flags/size from /repos"
```

---

## Task 3: Card badges  ·  **sonnet 4.6**

**Files:** Modify `src/components/RepoCard.tsx`

- [ ] **Step 1: Add imports + a staleness-color helper**

Add `Eye` and `ExternalLink` to the lucide-react import (currently `Code2, FolderOpen, FileText, Star, CircleDot, Tag`).
Add after the existing imports:
```ts
import { open as openExternal } from '@tauri-apps/plugin-shell';
```
Add this helper next to `ciColor`:
```ts
/** Tailwind text color for staleness based on an ISO push date. */
function staleColor(iso: string): string {
  if (iso === '') return 'text-navy-light';
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (Number.isNaN(days)) return 'text-navy-light';
  if (days < 30) return 'text-sage';
  if (days <= 90) return 'text-navy-light';
  return 'text-amber-500';
}
```

- [ ] **Step 2: Add the badges to the GitHub badges row**

In the `{gh && ( … )}` badges row, after the `latestRelease` span (before the row's closing `</div>`), add:

```tsx
          {relativeAge(gh.pushedAt) && (
            <span className={staleColor(gh.pushedAt)} title={`Last push ${gh.pushedAt}`}>
              updated {relativeAge(gh.pushedAt)}
            </span>
          )}
          {gh.fork && (
            <span className="px-1.5 py-0.5 bg-navy/10 text-navy-light font-medium leading-none">
              fork
            </span>
          )}
          {gh.watchers > 0 && (
            <span className="flex items-center gap-0.5" title="Watchers">
              <Eye size={11} strokeWidth={1.75} /> {gh.watchers}
            </span>
          )}
          {gh.homepage && (
            <button
              type="button"
              onClick={() => { if (gh.homepage) void openExternal(gh.homepage); }}
              className="flex items-center gap-0.5 text-navy-light hover:text-sage transition-colors cursor-pointer"
              title={`Homepage: ${gh.homepage}`}
              aria-label="Open homepage"
            >
              <ExternalLink size={11} strokeWidth={1.75} /> site
            </button>
          )}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc exit 0; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/RepoCard.tsx
git commit -m "feat(card): staleness + fork + watchers + homepage badges"
```

---

## Task 4: Overview band additions  ·  **sonnet 4.6**

**Files:** Modify `src/components/RepoDetail.tsx`

- [ ] **Step 1: Add `Eye` to the lucide import**

Add `Eye` to the existing lucide-react import list in `RepoDetail.tsx`.

- [ ] **Step 2: Add a local `relativeAge` + `formatSize` helper**

Add near the top of the file (module scope, after imports, before `TreeRow`):
```ts
/** Compact relative age like "3d"/"5h"/"2w" from an ISO timestamp; '' when empty/bad. */
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

/** Format a GitHub repo size (KB) as "N KB" or "N.N MB". */
function formatSize(kb: number): string {
  return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`;
}
```

- [ ] **Step 3: Append fields inside the overview band's `repo.gh` branch**

In the overview band, inside the `{repo.gh ? ( <> … </> ) : ( … )}` fragment, after the existing topics span (the last element before `</>`), add:

```tsx
              <span className="flex items-center gap-1" title="Watchers"><Eye size={12} strokeWidth={1.75} />{repo.gh.watchers}</span>
              {relativeAge(repo.gh.updatedAt) && <span title={`Updated ${repo.gh.updatedAt}`}>updated {relativeAge(repo.gh.updatedAt)}</span>}
              <span className="font-mono">{formatSize(repo.gh.size)}</span>
              <span className="font-mono">branch: {repo.gh.defaultBranch}</span>
              {repo.gh.disabled && <span className="px-1.5 py-0.5 bg-navy/10 text-navy-light text-[10px]">disabled</span>}
              {repo.gh.fork && repo.gh.parent && (
                <button
                  type="button"
                  onClick={() => { if (repo.gh?.parent) void openExternal(repo.gh.parent.url); }}
                  className="text-sage hover:underline cursor-pointer"
                  title="Open upstream repository"
                >
                  fork of {repo.gh.parent.fullName}
                </button>
              )}
              {repo.gh.homepage && (
                <button
                  type="button"
                  onClick={() => { if (repo.gh?.homepage) void openExternal(repo.gh.homepage); }}
                  className="flex items-center gap-1 text-sage hover:underline cursor-pointer"
                  title={repo.gh.homepage}
                >
                  <ExternalLink size={12} strokeWidth={1.75} />homepage
                </button>
              )}
              {(repo.gh.hasIssues || repo.gh.hasWiki || repo.gh.hasPages) && (
                <span className="flex items-center gap-1">
                  {repo.gh.hasIssues && <span className="px-1.5 py-0.5 bg-sage/15 text-sage text-[10px] font-mono">issues</span>}
                  {repo.gh.hasWiki && <span className="px-1.5 py-0.5 bg-sage/15 text-sage text-[10px] font-mono">wiki</span>}
                  {repo.gh.hasPages && <span className="px-1.5 py-0.5 bg-sage/15 text-sage text-[10px] font-mono">pages</span>}
                </span>
              )}
```

(`ExternalLink` and `openExternal` are already imported in `RepoDetail.tsx` from the previous feature.)

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc exit 0; build succeeds. (If `repo.gh?.homepage`/`parent` narrowing complains, the `if (repo.gh?.…)` guards inside the onClick handle it; the `&&` render guards ensure the values are non-null at click time.)

- [ ] **Step 5: Commit**

```bash
git add src/components/RepoDetail.tsx
git commit -m "feat(detail): overview band shows watchers/size/branch/fork/homepage/caps"
```

---

## Task 5: Integration verify  ·  **opus 4.8**

**Files:** none

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc 0; all vitest green (github mapper test now covers new fields); build succeeds.

- [ ] **Step 2: Live check (running app / HMR)**

Trigger a rescan (Settings → Rescan now) so enrichment repopulates `repo.gh`. Screenshot the board + open a repo.
Expected: cards show `updated {age}` (colored by staleness), `fork` tag on forks, watchers + `site` link where applicable. Overview band shows watchers, updated age, size, default branch, fork-of link, homepage link, and issues/wiki/pages chips.

- [ ] **Step 3: Commit any fixes**

If issues surface, fix the smallest change, re-run Step 1, commit.

---

## Notes for the executor

- All new data comes from the existing `/repos` call in `fetchRepoCard` — no new endpoints, no extra rate-limit cost.
- Match existing Tailwind tokens (`sage`/`terracotta`/`navy`/`navy-light`/`warm-gray`/`amber-500`).
- `relativeAge` is intentionally duplicated in RepoCard and RepoDetail (tiny helper) — do not refactor into a shared module in this pass.
