# Repo Dashboard Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `RepoCard` into a compact editorial information-dashboard card with adaptive GitHub/local stats, an at-a-glance sync header, and AI-ready slots.

**Architecture:** A new Rust command supplies local git stats; the store merges them into each `Repo`. A pure `repoStats` util derives all card-display data; three small presentational components (`CardHeader`, `StatGrid`, `SyncBadges`) render it; `RepoCard` composes them. Pure logic is unit-tested with vitest; the Rust command has a cargo test against the project's own repo.

**Tech Stack:** Tauri 2 (Rust), React 19 + TypeScript, Zustand, Tailwind 4, lucide-react, vitest.

---

## File Structure

| File                                 | Responsibility                                  | Action  |
| ------------------------------------ | ----------------------------------------------- | ------- |
| `src-tauri/src/commands.rs`          | `git_local_stats` command                       | Modify  |
| `src-tauri/src/lib.rs`               | register command in handler                     | Modify  |
| `src/types.ts`                       | `Repo` runtime + AI optional fields             | Modify  |
| `src/store/useBoardStore.ts`         | merge local stats in `enrichGit`/`enrichGitOne` | Modify  |
| `src/utils/languageColor.ts`         | language → hex map                              | Create  |
| `src/utils/languageColor.test.ts`    | tests                                           | Create  |
| `src/utils/repoStats.ts`             | pure card-data derivation                       | Create  |
| `src/utils/repoStats.test.ts`        | tests                                           | Create  |
| `src/components/card/SyncBadges.tsx` | ahead/behind/dirty/CI badges                    | Create  |
| `src/components/card/StatGrid.tsx`   | adaptive 3-stat grid                            | Create  |
| `src/components/card/CardHeader.tsx` | lang dot/tint, watermark, handle, name          | Create  |
| `src/components/RepoCard.tsx`        | composition + actions + AI slots                | Rewrite |

**Theme tokens (reuse, do not invent):** `navy`, `navy-light`, `sage`, `terracotta`, `amber-500`, `warm-gray`, `dusty-pink`. Card background changes from `bg-warm-gray` to `bg-white`. Radius stays `rounded-xl`.

---

## Task 1: Rust `git_local_stats` command

**Files:**

- Modify: `src-tauri/src/commands.rs` (append command + test)
- Modify: `src-tauri/src/lib.rs` (register in `generate_handler!`)

- [ ] **Step 1: Append the command to `commands.rs`**

Add at end of `src-tauri/src/commands.rs`:

```rust
/// Local-only repo stats for cards without GitHub enrichment.
///
/// Returns total commit count on HEAD, the last commit time (ISO 8601), and
/// the number of local branches. Any field that cannot be computed (e.g. an
/// empty repo with no commits) is returned as 0 / null rather than erroring,
/// so a single odd repo never breaks the scan.
#[tauri::command]
pub fn git_local_stats(path: String) -> Result<(i64, Option<String>, i64), String> {
    // Commit count on HEAD. Empty repo → rev-list fails → 0.
    let commit_count = Command::new("git")
        .args(["-C", &path, "rev-list", "--count", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<i64>().ok())
        .unwrap_or(0);

    // Last commit time, strict ISO 8601. None on empty repo.
    let last_commit_at = Command::new("git")
        .args(["-C", &path, "log", "-1", "--format=%cI"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());

    // Local branch count.
    let branch_count = Command::new("git")
        .args(["-C", &path, "branch", "--format=%(refname:short)"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|l| !l.trim().is_empty())
                .count() as i64
        })
        .unwrap_or(0);

    Ok((commit_count, last_commit_at, branch_count))
}

#[cfg(test)]
mod local_stats_tests {
    use super::*;

    #[test]
    fn reports_stats_for_this_repo() {
        // The crate lives inside the project's own git repo.
        let (commits, last, branches) = git_local_stats(env!("CARGO_MANIFEST_DIR").to_string())
            .expect("git_local_stats should succeed in a repo");
        assert!(commits >= 1, "expected at least one commit, got {commits}");
        assert!(last.is_some(), "expected a last-commit timestamp");
        assert!(branches >= 1, "expected at least one branch, got {branches}");
    }
}
```

- [ ] **Step 2: Run the test to verify it fails to compile, then passes after the function exists**

Run: `cd src-tauri && cargo test local_stats_tests`
Expected: PASS (`reports_stats_for_this_repo`). If it fails to compile, the function body above is incomplete — re-check Step 1.

- [ ] **Step 3: Register the command in `lib.rs`**

In `src-tauri/src/lib.rs`, add `commands::git_local_stats` to the `generate_handler!` list (after `commands::git_fetch`):

```rust
        .invoke_handler(tauri::generate_handler![
            commands::store_token,
            commands::get_token,
            commands::open_in_editor,
            commands::open_in_terminal,
            commands::git_ahead_behind,
            commands::git_branches,
            commands::git_fetch,
            commands::git_local_stats
        ])
```

- [ ] **Step 4: Verify the crate builds**

Run: `cd src-tauri && cargo build`
Expected: builds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(git): add git_local_stats command (commits, last commit, branches)"
```

---

## Task 2: Extend the `Repo` type

**Files:**

- Modify: `src/types.ts` (the `Repo` interface, after the `behind` field)

- [ ] **Step 1: Add the new optional fields to `Repo`**

In `src/types.ts`, inside `export interface Repo`, after the `behind?` field, add:

```ts
  /** Total commits on HEAD (runtime; from git_local_stats). */
  commitCount?: number | null;
  /** Last commit time, ISO 8601 (runtime; null on empty repo). */
  lastCommitAt?: string | null;
  /** Local branch count (runtime; from git_local_stats). */
  branchCount?: number | null;
  /** AI-generated one-line summary; populated by a later AI cycle. */
  aiSummary?: string | null;
  /** AI-generated topic tags; populated by a later AI cycle. */
  aiTags?: string[] | null;
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add local-stat and AI-slot fields to Repo"
```

---

## Task 3: Merge local stats in the store

**Files:**

- Modify: `src/store/useBoardStore.ts` (`enrichGit` worker and `enrichGitOne`)

- [ ] **Step 1: Extend the `enrichGit` worker to fetch local stats**

In `src/store/useBoardStore.ts`, find `enrichGit`. Replace the `byPath` map type and worker body so each repo also gets local stats. Change:

```ts
const byPath = new Map<string, { ahead: number; behind: number } | null>();
```

to:

```ts
const byPath = new Map<
  string,
  {
    ahead: number | null;
    behind: number | null;
    commitCount: number;
    lastCommitAt: string | null;
    branchCount: number;
  }
>();
```

Replace the worker's `try` block body with:

```ts
try {
  // git_ahead_behind returns [ahead, behind] or null (no upstream).
  const ab = await invoke<[number, number] | null>('git_ahead_behind', {
    path: repo.path,
  });
  // git_local_stats returns [commitCount, lastCommitAt, branchCount].
  const ls = await invoke<[number, string | null, number]>('git_local_stats', {
    path: repo.path,
  });
  byPath.set(repo.path, {
    ahead: ab === null ? null : ab[0],
    behind: ab === null ? null : ab[1],
    commitCount: ls[0],
    lastCommitAt: ls[1],
    branchCount: ls[2],
  });
} catch {
  byPath.set(repo.path, {
    ahead: null,
    behind: null,
    commitCount: 0,
    lastCommitAt: null,
    branchCount: 0,
  });
}
```

Replace the merge `set(...)` at the end of `enrichGit` with:

```ts
set((s) => ({
  repos: s.repos.map((r) => {
    const v = byPath.get(r.path);
    if (!v) return r;
    return {
      ...r,
      ahead: v.ahead,
      behind: v.behind,
      commitCount: v.commitCount,
      lastCommitAt: v.lastCommitAt,
      branchCount: v.branchCount,
    };
  }),
}));
```

- [ ] **Step 2: Extend `enrichGitOne`**

Replace the body of `enrichGitOne` with:

```ts
  enrichGitOne: async (path) => {
    let ab: [number, number] | null = null;
    let ls: [number, string | null, number] = [0, null, 0];
    try {
      ab = await invoke<[number, number] | null>('git_ahead_behind', { path });
      ls = await invoke<[number, string | null, number]>('git_local_stats', { path });
    } catch {
      return;
    }
    set((s) => ({
      repos: s.repos.map((r) =>
        r.path === path
          ? {
              ...r,
              ahead: ab?.[0] ?? null,
              behind: ab?.[1] ?? null,
              commitCount: ls[0],
              lastCommitAt: ls[1],
              branchCount: ls[2],
            }
          : r,
      ),
    }));
  },
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/store/useBoardStore.ts
git commit -m "feat(store): merge git_local_stats into repo enrichment"
```

---

## Task 4: `languageColor` util

**Files:**

- Create: `src/utils/languageColor.ts`
- Test: `src/utils/languageColor.test.ts`

- [ ] **Step 1: Write the failing test**

`src/utils/languageColor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { languageColor } from './languageColor';

describe('languageColor', () => {
  it('returns the known color for a language (case-insensitive)', () => {
    expect(languageColor('TypeScript')).toBe('#3178c6');
    expect(languageColor('typescript')).toBe('#3178c6');
    expect(languageColor('Rust')).toBe('#dea584');
  });

  it('returns the neutral fallback for unknown or null languages', () => {
    expect(languageColor(null)).toBe('#9ca3af');
    expect(languageColor('Nonsense')).toBe('#9ca3af');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/languageColor.test.ts`
Expected: FAIL — cannot find module `./languageColor`.

- [ ] **Step 3: Implement `languageColor.ts`**

```ts
// languageColor.ts — map a programming language to a representative hex color.
// Subset of GitHub Linguist colors; keys are matched case-insensitively.
// Unknown / null languages fall back to a neutral gray.

const NEUTRAL = '#9ca3af';

const COLORS: Record<string, string> = {
  typescript: '#3178c6',
  javascript: '#f1e05a',
  rust: '#dea584',
  python: '#3572a5',
  go: '#00add8',
  swift: '#f05138',
  java: '#b07219',
  kotlin: '#a97bff',
  ruby: '#701516',
  c: '#555555',
  'c++': '#f34b7d',
  'c#': '#178600',
  php: '#4f5d95',
  html: '#e34c26',
  css: '#563d7c',
  shell: '#89e051',
  vue: '#41b883',
  svelte: '#ff3e00',
  dart: '#00b4ab',
  elixir: '#6e4a7e',
  scala: '#c22d40',
  haskell: '#5e5086',
  lua: '#000080',
  zig: '#ec915c',
};

/** Hex color for a language name, or a neutral fallback when unknown/null. */
export function languageColor(language: string | null | undefined): string {
  if (!language) return NEUTRAL;
  return COLORS[language.toLowerCase()] ?? NEUTRAL;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/languageColor.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/languageColor.ts src/utils/languageColor.test.ts
git commit -m "feat(utils): add languageColor map"
```

---

## Task 5: `repoStats` pure derivation util

**Files:**

- Create: `src/utils/repoStats.ts`
- Test: `src/utils/repoStats.test.ts`

- [ ] **Step 1: Write the failing test**

`src/utils/repoStats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseHandle, relativeAge, deriveCardData } from './repoStats';
import type { Repo } from '../types';

const FIXED_NOW = Date.parse('2026-06-08T00:00:00Z');

function baseRepo(over: Partial<Repo> = {}): Repo {
  return {
    name: 'Coruro',
    path: '/Users/x/Github/Coruro',
    branch: 'main',
    dirty: false,
    prCount: 0,
    ...over,
  };
}

describe('parseHandle', () => {
  it('extracts owner from ssh and https remotes', () => {
    expect(parseHandle('git@github.com:felipemillan/Coruro.git')).toBe('@felipemillan');
    expect(parseHandle('https://github.com/felipemillan/Coruro.git')).toBe('@felipemillan');
    expect(parseHandle('https://github.com/felipemillan/Coruro')).toBe('@felipemillan');
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
      remoteUrl: 'git@github.com:felipemillan/Coruro.git',
      gh: {
        stars: 128,
        forks: 4,
        isPrivate: false,
        archived: false,
        openIssues: 12,
        prCount: 0,
        ciStatus: 'success',
        latestRelease: null,
        description: 'Git dashboard',
        topics: ['rust', 'tauri'],
        language: 'Rust',
        license: 'MIT',
        defaultBranch: 'main',
        pushedAt: '2026-06-07T00:00:00Z',
        htmlUrl: 'https://github.com/felipemillan/Coruro',
        watchers: 3,
        updatedAt: '2026-06-07T00:00:00Z',
        disabled: false,
        fork: false,
        parent: null,
        homepage: null,
        hasIssues: true,
        hasWiki: false,
        hasPages: false,
        size: 100,
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
      commitCount: 340,
      branchCount: 6,
      lastCommitAt: '2026-06-05T00:00:00Z',
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/repoStats.test.ts`
Expected: FAIL — cannot find module `./repoStats`.

- [ ] **Step 3: Implement `repoStats.ts`**

```ts
// repoStats.ts — pure derivation of everything a RepoCard renders.
// No React, no IO. Single source of card-display data so components stay dumb.

import type { Repo } from '../types';

/** One cell in the card's 3-stat grid. */
export interface CardStat {
  value: string;
  label: string;
}

/** Everything a card needs, derived from a Repo. */
export interface CardData {
  name: string;
  handle: string | null;
  description: string | null;
  tags: string[];
  language: string | null;
  isLocalOnly: boolean;
  displayStats: CardStat[];
  stale: boolean;
  sync: { dirty: boolean; ahead: number; behind: number; ciStatus: string };
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
}

const STALE_DAYS = 90;

/** Extract `@owner` from a github remote URL, or null when unparseable. */
export function parseHandle(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) return null;
  // ssh: git@github.com:owner/repo(.git)?  |  https: https://host/owner/repo(.git)?
  const ssh = remoteUrl.match(/^[^@]+@[^:]+:([^/]+)\/[^/]+?(?:\.git)?$/);
  if (ssh) return `@${ssh[1]}`;
  const https = remoteUrl.match(/^https?:\/\/[^/]+\/([^/]+)\/[^/]+?(?:\.git)?$/);
  if (https) return `@${https[1]}`;
  return null;
}

/** Compact relative age like "3d" / "5h" / "2w" from an ISO timestamp. */
export function relativeAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.max(0, (now - then) / 1000);
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d`;
  if (sec < 2629800) return `${Math.floor(sec / 604800)}w`;
  return `${Math.floor(sec / 2629800)}mo`;
}

/** Derive all card-display data from a repo. `now` is injectable for tests. */
export function deriveCardData(repo: Repo, now: number = Date.now()): CardData {
  const gh = repo.gh ?? null;
  const isLocalOnly = gh === null;

  const displayStats: CardStat[] = isLocalOnly
    ? [
        { value: String(repo.commitCount ?? 0), label: 'COMMITS' },
        { value: String(repo.branchCount ?? 0), label: 'BRANCHES' },
        { value: relativeAge(repo.lastCommitAt, now) || '—', label: 'LAST' },
      ]
    : [
        { value: String(gh!.stars), label: 'STARS' },
        { value: String(gh!.openIssues), label: 'ISSUES' },
        { value: String(gh!.forks), label: 'FORKS' },
      ];

  const staleSource = gh?.pushedAt ?? repo.lastCommitAt ?? null;
  const stale =
    staleSource !== null &&
    !Number.isNaN(new Date(staleSource).getTime()) &&
    (now - new Date(staleSource).getTime()) / 86400000 > STALE_DAYS;

  return {
    name: repo.name,
    handle: parseHandle(repo.remoteUrl),
    description: repo.aiSummary ?? gh?.description ?? null,
    tags: repo.aiTags ?? gh?.topics ?? [],
    language: gh?.language ?? null,
    isLocalOnly,
    displayStats,
    stale,
    sync: {
      dirty: repo.dirty,
      ahead: repo.ahead ?? 0,
      behind: repo.behind ?? 0,
      ciStatus: gh?.ciStatus ?? 'none',
    },
    isPrivate: gh?.isPrivate ?? false,
    isFork: gh?.fork ?? false,
    isArchived: gh?.archived ?? false,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/repoStats.test.ts`
Expected: PASS (all `deriveCardData`, `parseHandle`, `relativeAge` tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/repoStats.ts src/utils/repoStats.test.ts
git commit -m "feat(utils): add pure repoStats card-data derivation"
```

---

## Task 6: `SyncBadges` component

**Files:**

- Create: `src/components/card/SyncBadges.tsx`
- Test: `src/components/card/SyncBadges.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/card/SyncBadges.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SyncBadges } from './SyncBadges';

describe('SyncBadges', () => {
  it('shows dirty and ahead/behind counts', () => {
    const html = renderToStaticMarkup(
      <SyncBadges sync={{ dirty: true, ahead: 2, behind: 1, ciStatus: 'success' }} />,
    );
    expect(html).toContain('dirty');
    expect(html).toContain('2');
    expect(html).toContain('1');
  });

  it('shows clean and hides zero ahead/behind', () => {
    const html = renderToStaticMarkup(
      <SyncBadges sync={{ dirty: false, ahead: 0, behind: 0, ciStatus: 'none' }} />,
    );
    expect(html).toContain('clean');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/card/SyncBadges.test.tsx`
Expected: FAIL — cannot find module `./SyncBadges`.

- [ ] **Step 3: Implement `SyncBadges.tsx`**

```tsx
// SyncBadges.tsx — at-a-glance sync state for a repo card header.
// Renders a dirty/clean pill, ahead/behind counts, and a CI dot.

import { ArrowUp, ArrowDown, CircleDot } from 'lucide-react';
import type { CardData } from '../../utils/repoStats';

interface SyncBadgesProps {
  sync: CardData['sync'];
}

function ciColor(status: string): string | null {
  switch (status) {
    case 'success':
      return 'text-sage';
    case 'failure':
      return 'text-terracotta';
    case 'pending':
      return 'text-amber-500';
    default:
      return null;
  }
}

export function SyncBadges({ sync }: SyncBadgesProps) {
  const ci = ciColor(sync.ciStatus);
  return (
    <div className="flex items-center gap-2 text-[11px] leading-none">
      <span
        className={[
          'px-1.5 py-0.5 font-medium rounded-full',
          sync.dirty ? 'bg-terracotta/20 text-terracotta' : 'bg-sage/20 text-sage',
        ].join(' ')}
        aria-label={sync.dirty ? 'Uncommitted changes' : 'Working tree clean'}
      >
        {sync.dirty ? 'dirty' : 'clean'}
      </span>

      {sync.ahead > 0 && (
        <span className="flex items-center gap-0.5 text-sage" title="Commits ahead">
          <ArrowUp size={11} strokeWidth={2} />
          {sync.ahead}
        </span>
      )}
      {sync.behind > 0 && (
        <span className="flex items-center gap-0.5 text-amber-500" title="Commits behind">
          <ArrowDown size={11} strokeWidth={2} />
          {sync.behind}
        </span>
      )}

      {ci !== null && (
        <span className={`flex items-center gap-0.5 ${ci}`} title={`CI: ${sync.ciStatus}`}>
          <CircleDot size={11} strokeWidth={2} />
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/card/SyncBadges.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/card/SyncBadges.tsx src/components/card/SyncBadges.test.tsx
git commit -m "feat(card): add SyncBadges component"
```

---

## Task 7: `StatGrid` component

**Files:**

- Create: `src/components/card/StatGrid.tsx`
- Test: `src/components/card/StatGrid.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/card/StatGrid.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatGrid } from './StatGrid';

describe('StatGrid', () => {
  it('renders all three stats with values and labels', () => {
    const html = renderToStaticMarkup(
      <StatGrid
        stats={[
          { value: '128', label: 'STARS' },
          { value: '12', label: 'ISSUES' },
          { value: '4', label: 'FORKS' },
        ]}
      />,
    );
    expect(html).toContain('128');
    expect(html).toContain('STARS');
    expect(html).toContain('FORKS');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/card/StatGrid.test.tsx`
Expected: FAIL — cannot find module `./StatGrid`.

- [ ] **Step 3: Implement `StatGrid.tsx`**

```tsx
// StatGrid.tsx — the divider-separated 3-stat grid on a repo card.
// Values/labels are pre-derived by repoStats; this component is presentational.

import type { CardStat } from '../../utils/repoStats';

interface StatGridProps {
  stats: CardStat[];
}

export function StatGrid({ stats }: StatGridProps) {
  return (
    <div className="grid grid-cols-3 border-t border-navy/10">
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={[
            'py-1.5 px-1 text-center',
            i < stats.length - 1 ? 'border-r border-navy/10' : '',
          ].join(' ')}
        >
          <span className="block text-navy font-semibold text-sm leading-none tabular-nums">
            {s.value}
          </span>
          <span className="block text-navy-light text-[9px] font-bold tracking-wider mt-0.5">
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/card/StatGrid.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/card/StatGrid.tsx src/components/card/StatGrid.test.tsx
git commit -m "feat(card): add StatGrid component"
```

---

## Task 8: `CardHeader` component

**Files:**

- Create: `src/components/card/CardHeader.tsx`
- Test: `src/components/card/CardHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/card/CardHeader.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardHeader } from './CardHeader';

describe('CardHeader', () => {
  it('renders language label and watermark initials', () => {
    const html = renderToStaticMarkup(
      <CardHeader
        name="Coruro"
        language="Rust"
        sync={{ dirty: false, ahead: 0, behind: 0, ciStatus: 'none' }}
      />,
    );
    expect(html).toContain('Rust');
    // Watermark initials = first two letters of name, uppercased.
    expect(html).toContain('MY');
  });

  it('omits language label when language is null', () => {
    const html = renderToStaticMarkup(
      <CardHeader
        name="x"
        language={null}
        sync={{ dirty: true, ahead: 0, behind: 0, ciStatus: 'none' }}
      />,
    );
    expect(html).toContain('dirty');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/card/CardHeader.test.tsx`
Expected: FAIL — cannot find module `./CardHeader`.

- [ ] **Step 3: Implement `CardHeader.tsx`**

```tsx
// CardHeader.tsx — the tinted top band of a repo card: language dot + label,
// a faint watermark of the repo initials, and the sync-state badge row.

import { languageColor } from '../../utils/languageColor';
import { SyncBadges } from './SyncBadges';
import type { CardData } from '../../utils/repoStats';

interface CardHeaderProps {
  name: string;
  language: string | null;
  sync: CardData['sync'];
}

/** First two alphanumeric chars of the name, uppercased (watermark). */
function initials(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9]/g, '');
  return clean.slice(0, 2).toUpperCase();
}

export function CardHeader({ name, language, sync }: CardHeaderProps) {
  const color = languageColor(language);
  return (
    <div
      className="relative overflow-hidden rounded-t-xl px-3 py-2 flex items-center justify-between"
      style={{ background: `${color}1a` }} // ~10% alpha tint
    >
      {/* Watermark initials */}
      <span
        className="pointer-events-none absolute -right-1 -bottom-3 text-4xl font-black leading-none select-none"
        style={{ color: `${color}26` }} // ~15% alpha
        aria-hidden="true"
      >
        {initials(name)}
      </span>

      <span className="relative flex items-center gap-1.5 text-[11px] font-medium text-navy">
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ background: color }}
          aria-hidden="true"
        />
        {language && <span>{language}</span>}
      </span>

      <span className="relative">
        <SyncBadges sync={sync} />
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/card/CardHeader.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/card/CardHeader.tsx src/components/card/CardHeader.test.tsx
git commit -m "feat(card): add CardHeader band component"
```

---

## Task 9: Rewrite `RepoCard` to compose the editorial card

**Files:**

- Rewrite: `src/components/RepoCard.tsx`
- Test: `src/components/RepoCard.test.tsx` (create)

Preserve all existing behavior: action buttons (detail, editor, terminal, Finder, GitHub, refresh), the `openError` state, store/view selectors, and `data-path`. Only the visual structure changes.

- [ ] **Step 1: Write the failing test**

`src/components/RepoCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RepoCard } from './RepoCard';
import type { Repo } from '../types';

// Stub stores so the component renders without a live Zustand provider.
vi.mock('../store/useBoardStore', () => ({
  useBoardStore: (sel: (s: unknown) => unknown) =>
    sel({
      settings: { editorCommand: 'code', editorApp: 'VS Code', terminalApp: 'Terminal' },
      enrichOne: () => {},
    }),
}));
vi.mock('../store/useViewStore', () => ({
  useViewStore: (sel: (s: unknown) => unknown) => sel({ setDetail: () => {} }),
}));

const localRepo: Repo = {
  name: 'Coruro',
  path: '/x/Coruro',
  branch: 'main',
  dirty: true,
  prCount: 0,
  commitCount: 340,
  branchCount: 6,
  lastCommitAt: '2026-06-05T00:00:00Z',
};

describe('RepoCard', () => {
  it('renders name, local stats, and the data-path attribute', () => {
    const html = renderToStaticMarkup(<RepoCard repo={localRepo} />);
    expect(html).toContain('Coruro');
    expect(html).toContain('340');
    expect(html).toContain('COMMITS');
    expect(html).toContain('data-path="/x/Coruro"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/RepoCard.test.tsx`
Expected: FAIL — the current card renders `bg-warm-gray` flat layout and has no `COMMITS` text.

- [ ] **Step 3: Rewrite `RepoCard.tsx`**

```tsx
// RepoCard.tsx — editorial information-dashboard card for one repository.
//
// Composes: CardHeader (lang tint + sync glance), an identity block
// (handle / name / description / tags), an adaptive StatGrid, and an action
// row. All display data is derived by repoStats; this file wires behavior.
//
// AI-ready: description renders repo.aiSummary when present (else GitHub
// description); tags render repo.aiTags when present (else GitHub topics).
// Both are produced by deriveCardData — later AI cycles just populate fields.

import { useState } from 'react';
import {
  Code2,
  FolderOpen,
  FileText,
  ExternalLink,
  TerminalSquare,
  RefreshCw,
  Lock,
  GitFork,
  Archive,
} from 'lucide-react';
import { Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { safeOpenUrl } from '../utils/openUrl';
import { useBoardStore } from '../store/useBoardStore';
import { useViewStore } from '../store/useViewStore';
import { deriveCardData } from '../utils/repoStats';
import { CardHeader } from './card/CardHeader';
import { StatGrid } from './card/StatGrid';
import type { Repo } from '../types';

interface RepoCardProps {
  repo: Repo;
  selected?: boolean;
}

export function RepoCard({ repo, selected = false }: RepoCardProps) {
  const editorCommand = useBoardStore((s) => s.settings.editorCommand);
  const editorApp = useBoardStore((s) => s.settings.editorApp);
  const terminalApp = useBoardStore((s) => s.settings.terminalApp);
  const setDetail = useViewStore((s) => s.setDetail);
  const enrichOne = useBoardStore((s) => s.enrichOne);

  const [openError, setOpenError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const d = deriveCardData(repo);
  const htmlUrl = repo.gh?.htmlUrl ?? null;

  async function openInEditor() {
    setOpenError(null);
    try {
      await invoke('open_in_editor', { command: editorCommand, app: editorApp, path: repo.path });
    } catch (e: unknown) {
      setOpenError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openInTerminal() {
    setOpenError(null);
    try {
      await invoke('open_in_terminal', { app: terminalApp, path: repo.path });
    } catch (e: unknown) {
      setOpenError(e instanceof Error ? e.message : String(e));
    }
  }

  async function revealInFinder() {
    await Command.create('open', ['--', repo.path]).execute();
  }

  async function refreshGitHub() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await enrichOne(repo.path);
    } finally {
      setRefreshing(false);
    }
  }

  const iconBtn =
    'p-1 rounded-full text-navy-light hover:text-sage hover:bg-navy/8 transition-colors';

  return (
    <article
      className={[
        'bg-white border flex flex-col shadow-sm transition-shadow rounded-xl overflow-hidden',
        d.stale ? 'opacity-70' : '',
        selected ? 'border-sage ring-2 ring-sage' : 'border-navy/10',
      ].join(' ')}
      data-path={repo.path}
    >
      <CardHeader name={d.name} language={d.language} sync={d.sync} />

      {/* Identity block */}
      <div className="px-3 pt-2 pb-2 flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {d.handle && (
              <p className="text-[10px] font-bold tracking-wider text-navy-light uppercase truncate">
                {d.handle}
              </p>
            )}
            <h3
              className="text-navy font-bold text-base leading-tight tracking-tight break-words"
              title={repo.path}
            >
              {d.name}
            </h3>
          </div>
          <div className="flex items-center gap-0.5 shrink-0 text-navy-light">
            {d.isPrivate && <Lock size={12} strokeWidth={2} aria-label="Private" />}
            {d.isFork && <GitFork size={12} strokeWidth={2} aria-label="Fork" />}
            {d.isArchived && <Archive size={12} strokeWidth={2} aria-label="Archived" />}
          </div>
        </div>

        {d.description && (
          <p className="text-[12px] text-navy leading-snug border-l-2 border-terracotta pl-2 line-clamp-2">
            {d.description}
          </p>
        )}

        {d.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {d.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="text-[9px] font-medium px-1.5 py-0.5 bg-dusty-pink/30 text-navy-light rounded-full leading-none"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <StatGrid stats={d.displayStats} />

      {openError !== null && (
        <p className="text-[11px] text-terracotta leading-snug px-3 py-1" role="alert">
          {openError}
        </p>
      )}

      {/* Action row */}
      <div className="flex items-center justify-end gap-1 border-t border-navy/10 px-2 py-1">
        <button
          type="button"
          onClick={() => {
            void refreshGitHub();
          }}
          disabled={refreshing}
          className={`${iconBtn} disabled:opacity-50 disabled:cursor-not-allowed`}
          title="Refresh GitHub data"
          aria-label="Refresh GitHub data"
        >
          <RefreshCw size={14} strokeWidth={1.75} className={refreshing ? 'animate-spin' : ''} />
        </button>
        {htmlUrl && (
          <button
            type="button"
            onClick={() => {
              void safeOpenUrl(htmlUrl);
            }}
            className={iconBtn}
            title="Open on GitHub"
            aria-label="Open repository on GitHub"
          >
            <ExternalLink size={14} strokeWidth={1.75} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setDetail(repo.path)}
          className={iconBtn}
          title="View README & files"
          aria-label="View README and files"
        >
          <FileText size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => {
            void openInEditor();
          }}
          className={iconBtn}
          title={`Open in IDE (${editorCommand || editorApp})`}
          aria-label="Open in IDE"
        >
          <Code2 size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => {
            void openInTerminal();
          }}
          className={iconBtn}
          title={`Open in terminal (${terminalApp})`}
          aria-label="Open in terminal"
        >
          <TerminalSquare size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => {
            void revealInFinder();
          }}
          className={iconBtn}
          title="Reveal in Finder"
          aria-label="Reveal in Finder"
        >
          <FolderOpen size={14} strokeWidth={1.75} />
        </button>
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/RepoCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify `line-clamp` is available**

`line-clamp-2` ships with Tailwind 4 core. If the build warns it is unknown, confirm Tailwind ≥ 3.3; no plugin needed for v4.

- [ ] **Step 6: Commit**

```bash
git add src/components/RepoCard.tsx src/components/RepoCard.test.tsx
git commit -m "feat(card): rewrite RepoCard as editorial dashboard card"
```

---

## Task 10: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites pass (existing + new `languageColor`, `repoStats`, `SyncBadges`, `StatGrid`, `CardHeader`, `RepoCard`).

- [ ] **Step 2: Type-check and build the frontend**

Run: `npm run build`
Expected: `tsc` clean, vite build succeeds.

- [ ] **Step 3: Build the Rust side**

Run: `cd src-tauri && cargo build`
Expected: builds clean (warnings only, no errors).

- [ ] **Step 4: Visual smoke (manual)**

Run: `npm run tauri dev`
Confirm in the running app: cards show white background + soft shadow, tinted language header, sync badges, identity block, adaptive stat grid (GitHub repo shows STARS/ISSUES/FORKS; a local-only repo shows COMMITS/BRANCHES/LAST), and all action buttons work. Cards still fit the 5 Kanban columns without overflow.

- [ ] **Step 5: Final commit (if any lint/format fixups were needed)**

```bash
git add -A
git commit -m "chore(card): verification fixups for editorial card"
```

---

## Self-Review Notes

- **Spec coverage:** header sync logic (Task 8 + 6), adaptive stat grid (Task 5 + 7), AI-ready slots (Task 5 `deriveCardData` + Task 9 render), new Rust data (Task 1), type additions (Task 2), store wiring (Task 3), white-bg/soft-shadow skin (Task 9), tests (Tasks 4–9), verification (Task 10). All spec sections mapped.
- **Type consistency:** `CardData`, `CardStat`, and the `sync` shape `{ dirty, ahead, behind, ciStatus }` are used identically across `repoStats.ts`, `SyncBadges`, `CardHeader`, and `RepoCard`. The `git_local_stats` tuple `(i64, Option<String>, i64)` maps to the TS tuple `[number, string | null, number]` in both store call sites.
- **Deferred (not in scope):** condensed display font (using tight tracking), staleness-threshold setting, Apple Intelligence cycles.
