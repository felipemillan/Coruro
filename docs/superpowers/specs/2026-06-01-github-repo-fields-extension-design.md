# Design — Extended /repos fields on cards & overview

**Date:** 2026-06-01
**Status:** Approved (design), pending implementation plan
**Builds on:** `2026-06-01-github-data-cards-modal-design.md` (RepoGitHub / fetchRepoCard / RepoCard / RepoDetail overview band).
**Area:** `src/types.ts`, `src/utils/github.ts` (+ test), `src/components/RepoCard.tsx`, `src/components/RepoDetail.tsx`

## Goal

Surface the remaining useful fields from the single `GET /repos/{owner}/{repo}` call already made during enrichment — **zero extra API cost**. Add a tiered-color staleness badge, fork/watchers/homepage to cards, and the full field set to the modal overview band.

## Decisions (from brainstorming)

- **Card additions:** staleness badge (tiered color), `fork` tag, watchers count, homepage link icon.
- **Staleness:** always show `updated {age}` from `pushed_at`; color `<30d` sage, `30–90d` navy-light, `>90d` amber.
- **Fork/upstream:** card shows a `fork` tag; overview band shows `fork of {parent.fullName}` as a clickable link to the parent on GitHub.
- **Overview band:** shows all new fields.

## Data model — `src/types.ts`

`RepoGitHub` gains:

```ts
  watchers: number;          // subscribers_count
  updatedAt: string;         // updated_at (ISO 8601)
  disabled: boolean;
  fork: boolean;
  parent: { fullName: string; url: string } | null; // upstream; null unless a fork
  homepage: string | null;
  hasIssues: boolean;
  hasWiki: boolean;
  hasPages: boolean;
  size: number;              // repo size in KB (as GitHub reports)
```

Existing fields unchanged: `stars, forks, isPrivate, archived, openIssues, prCount, ciStatus, latestRelease, description, topics, language, license, defaultBranch, pushedAt`.

## `src/utils/github.ts`

- `RepoMetaSlice` gains the same new fields (except `prCount`/`ciStatus`/`latestRelease`, which are not from `/repos`).
- `mapRepoMeta(json)` maps them, with safe defaults on missing/wrong-typed fields:
  - `watchers` ← `subscribers_count` (number, else 0).
  - `updatedAt` ← `updated_at` (string, else '').
  - `disabled` ← `disabled === true`.
  - `fork` ← `fork === true`.
  - `parent` ← when `fork.parent` is an object with `full_name` (string): `{ fullName, url: parent.html_url ?? '' }`; else `null`.
  - `homepage` ← non-empty string, else `null`.
  - `hasIssues/hasWiki/hasPages` ← `has_issues/has_wiki/has_pages === true`.
  - `size` ← number, else 0.
- `fetchRepoCard` passes the new slice fields into the returned `RepoGitHub`.
- Update `mapRepoMeta` unit test to assert the new fields (full-object + defaults cases).

## `src/components/RepoCard.tsx`

In the GitHub badges row (only when `repo.gh`), add:

- **Staleness:** `updated {relativeAge(gh.pushedAt)}`; color via a `staleColor(pushedAt)` helper — sage if `<30d`, `text-navy-light` if `30–90d`, `text-amber-500` if `>90d`. Hidden when `pushedAt` is empty/unparseable.
- **fork** tag (`bg-navy/10 text-navy-light`) when `gh.fork`.
- **watchers:** `<Eye/> {gh.watchers}` when `> 0`.
- **homepage:** an external-link icon button that opens `gh.homepage` via `@tauri-apps/plugin-shell` `open`, when `homepage` is set. (RepoCard currently has no shell `open` import beyond `Command`; use `import { open as openExternal } from '@tauri-apps/plugin-shell'`.)

Reuse the existing `relativeAge` helper.

## `src/components/RepoDetail.tsx` — overview band

Append to the `repo.gh` branch of the overview band:

- watchers (`<Eye/> {watchers}`), `updated {relativeAge(updatedAt)}`, `size` formatted (`{size} KB` when `<1024`, else `{(size/1024).toFixed(1)} MB`), `branch: {defaultBranch}`.
- `homepage` → clickable link (opens via shell `open`).
- `fork of {parent.fullName}` → clickable link to `parent.url` when `fork && parent`.
- `disabled` flag (muted tag) when `disabled`.
- Capability chips for the enabled ones among `issues / wiki / pages` (`hasIssues/hasWiki/hasPages`).

Use the existing overview-band styling; add a small `relativeAge` helper local to RepoDetail (or import from a shared util) — keep consistent with RepoCard's formatting.

## Error handling

All fields come from the already-fetched `/repos` payload; missing/odd fields fall back to defaults in `mapRepoMeta` (never throws). No new network calls, no new failure modes.

## Testing

- `mapRepoMeta` vitest cases extended for the new fields (populated + defaults + `parent` present/absent).
- Card + overview rendering verified by running the app.

## Out of scope (YAGNI)

- No new endpoints. No card badges beyond the four agreed (staleness, fork, watchers, homepage). No persistence changes.

## Open risks

1. `relativeAge` duplication between RepoCard and RepoDetail — acceptable (tiny); a shared `src/utils/time.ts` is optional and not required by this change.
2. `size` from GitHub is in KB and can be large — formatting handles KB/MB; no GB tier (repos that large are rare and `{MB}` still reads fine).
