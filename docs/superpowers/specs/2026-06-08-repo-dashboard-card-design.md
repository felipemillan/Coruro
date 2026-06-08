# Repo Dashboard Card — Design Spec

**Date:** 2026-06-08
**Status:** Approved (design), pending implementation plan
**Slice:** 1 of N (card restyle). First slice of the larger "Apple Intelligence repo context" initiative.

---

## 1. Context

Coruro is a Tauri 2 + React 19 + Rust desktop app: a Kanban board of local git
repos enriched with GitHub data. Cards currently render minimal repo info.

This spec covers **only the card restyle** — reimagining each repo card as a compact
**information-dashboard card** that tells the user a lot about a project without
opening it. The card is also the canvas that later AI cycles fill (AI summary, AI
tags, analysis).

### The larger initiative (context only — not built in this slice)

Apple Intelligence integration to add tagging, relationships, analysis, statistics,
and semantic search across repos. Decomposed into sequential cycles, each its own
spec → plan → build:

1. Swift AI bridge (foundation) — `FoundationModels` (LLM) + `NaturalLanguage`
   `NLContextualEmbedding` (embeddings). Tauri/Rust reaches them via a Swift
   sidecar binary or Swift static lib + Rust FFI.
2. Repo context extraction (README, langs, commit history, file tree → AI features)
3. Tagging + analysis (first LLM consumer)
4. Semantic search (embeddings layer)
5. Relationships (builds on tags + embeddings)
6. Statistics tab (UI surface for all of the above)

**This card slice deliberately leaves AI-ready slots** so cycle 3+ plugs in without
restructuring.

## 2. Goals

- Replace `RepoCard.tsx` with a compact editorial dashboard card.
- Encode many repo signals at a glance (sync state, language, activity, health).
- Fit existing 5-column Kanban layout (~280px card width). No board layout change.
- Adaptive content: meaningful for both GitHub-backed and local-only repos.
- Leave optional AI slots (`aiSummary`, `aiTags`) that render when present.

### Non-goals (this slice)

- No Apple Intelligence / Swift work.
- No statistics tab, semantic search, relationships.
- No new web font (use system condensed / tight tracking; font decision deferred).

## 3. Visual design

**Skin:** Hybrid editorial — white background, soft drop shadow, 8px radius
(matches current Material 3 sage theme). Keeps information density + typographic
energy of a brutalist reference card, but with the soft M3 skin.

**Anatomy (compact, ~280px):**

```
┌─────────────────────────┐
│ ⬤Rust   ↑2 ↓1 ●dirty    │  header: lang dot + tint, sync state, CI dot
│  ▓ MG (watermark)        │
├─────────────────────────┤
│ @felipemillan            │  owner handle (parsed from remoteUrl)
│ Coruro          🔒     │  name (condensed) + private/fork/archive icon
│ ▌Git dashboard, Tauri…   │  description ── AI-BIO SLOT
│ [rust][tauri][cli]       │  topics chips ── AI-TAGS SLOT
├─────────────────────────┤
│  128  │   12  │  ★ 4     │  adaptive stat grid
│ STARS │ ISSUES│ FORKS    │
├─────────────────────────┤
│  Open ▸  Term ▸  GH ▸    │  actions (existing handlers)
└─────────────────────────┘
```

**Header sync logic (the glance):**
- Language dot color from a language → hex map.
- `↑ahead ↓behind` chips, hidden when 0 or no upstream.
- Dirty state: `●dirty` (red) / `●clean` (green).
- CI dot when `gh.ciStatus !== 'none'`.
- Staleness: `pushedAt` (or `lastCommitAt`) older than 90 days → faded card + "stale" hint.

**Adaptive stat grid (3 cells, divider-separated):**
- Has `gh`: stars · issues · forks.
- Local-only: commits · branches · last-commit age.

**AI-ready slots:** description region renders `repo.aiSummary` when present, else
`gh.description`. Topics chips render `repo.aiTags` when present, else `gh.topics`.

## 4. Data

### Existing (sufficient)
- `Repo`: name, path, branch, dirty, prCount, remoteUrl, gh, ahead, behind.
- `RepoGitHub`: stars, forks, openIssues, prCount, ciStatus, topics, language,
  license, description, pushedAt, htmlUrl, isPrivate, fork, archived, parent, …
- Rust commands: `git_ahead_behind`, `git_branches`, `git_fetch`.

### New (required for adaptive local-only stats)
- **Rust command** `git_local_stats(path) -> { commitCount: i64, lastCommitAt: String | null }`
  - `commitCount`: `git -C <path> rev-list --count HEAD`
  - `lastCommitAt`: `git -C <path> log -1 --format=%cI` (ISO 8601), null on empty repo.
  - Branch count derives from existing `git_branches().length`.
- **`Repo` type additions** (optional, runtime-only): `commitCount?: number | null`,
  `lastCommitAt?: string | null`, `branchCount?: number | null`.
- **`Repo` AI slots** (optional, populated by later cycles):
  `aiSummary?: string | null`, `aiTags?: string[] | null`.
- Scan path wires `git_local_stats` + branch count into each `Repo`.

## 5. Component architecture

Keep files focused and independently testable.

- `src/components/RepoCard.tsx` — composition only (wires the parts + action handlers).
- `src/components/card/CardHeader.tsx` — language dot/tint, watermark initials,
  sync badges row.
- `src/components/card/StatGrid.tsx` — adaptive 3-stat grid.
- `src/components/card/SyncBadges.tsx` — ahead/behind/dirty/CI badges.
- `src/utils/languageColor.ts` — `language → hex` map + fallback.
- `src/utils/repoStats.ts` — **pure**: `Repo → { handle, displayStats[], syncState,
  staleness, isLocalOnly }`. No React, no IO. Single source of card-derived data.

Each unit: clear single purpose, well-defined props/return, testable in isolation.

## 6. Styling

Tailwind 4 + existing Material 3 tokens (do not invent new color names — reuse the
sage-seed token remap already in the codebase). White card, soft elevation, 8px
radius. Condensed display treatment for repo name via tight letter-spacing /
`font-stretch` (no new font this slice). Accent rule on description = column color.

## 7. Error / edge handling

- No `gh` (local-only or fetch failed) → adaptive local stats, no GitHub chips.
- Empty repo (no commits) → `commitCount` 0, `lastCommitAt` null, no staleness fade.
- No upstream → hide ahead/behind chips.
- Missing language → neutral dot color, no tint.
- Long name/description → truncate with ellipsis, never break layout at 280px.

## 8. Testing

- vitest unit tests for `repoStats.ts` (adaptive selection, staleness threshold,
  handle parsing from various remote URL forms) and `languageColor.ts` (known +
  fallback).
- Component render smoke tests for `CardHeader`, `StatGrid`, `SyncBadges`,
  `RepoCard` (GitHub repo + local-only repo fixtures).
- Build + lint gate must pass.

## 9. Execution strategy — ultracode workflow

Dependency-aware pipeline. Model tier per task complexity
(haiku = mechanical, sonnet = standard impl, opus = integration / ambiguous / review).

**Phase 1 — Foundation** (blocks rest):
- `Repo` type fields + scan wiring + `git_local_stats` Rust command —
  agent: backend-developer — model: **sonnet**.

**Phase 2 — Parallel build** (independent after P1):
- `utils/languageColor.ts` — general — **haiku** (pure data).
- `utils/repoStats.ts` + vitest — typescript-pro — **sonnet**.
- `card/CardHeader.tsx` — ui-designer — **sonnet**.
- `card/StatGrid.tsx` — ui-designer — **sonnet**.
- `card/SyncBadges.tsx` — ui-designer — **sonnet**.

**Phase 3 — Compose** (barrier, needs all P2):
- `RepoCard.tsx` rewrite, wire AI-ready slots, M3 tokens —
  frontend-developer — **opus** (integration + design coherence).

**Phase 4 — Verify** (adversarial):
- Build + `npm test` + lint gate — general — **sonnet**.
- Visual + code review (M3 fidelity, 280px width, accessibility) —
  code-reviewer — **opus**.

Wall-clock ≈ P1 + slowest-P2 + P3 + P4. Parallel build agents run in worktree
isolation to avoid file conflicts.

## 10. Open items (deferred, not blocking)

- Condensed display font choice (system vs added font).
- Whether staleness threshold (90d) becomes a setting.
- Exact language → color palette source (reuse GitHub linguist colors).
