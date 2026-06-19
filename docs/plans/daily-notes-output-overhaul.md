# Plan — Radically Improve Daily Notes Output

**Source audit:** `.scratch/daily-notes-output-review-2026-06-19/sheldon-synthesis.md` (5-lens crew review)
**Decomposed by:** Leonard (3 phase-decomposers) + Leonard coherence-critic verify pass
**Critic verdict:** GO-WITH-FIXES — 2 blocking fixes (F1, F5) folded in below; 8 robustness fixes noted inline.
**Date:** 2026-06-19

15 PR-sized work items across 3 phases. Phase 1 ships first (TypeScript-only, biggest perceived win). Phase 2 unblocks + measures the AI. Phase 3 adds memory (contract change).

## Hard invariants (never violate)

- **P0 zero-network AI:** no sidecar call on app-only notes; metadata-only payloads. No raw paths/secrets/free-text to the sidecar.
- **Context-budget cap** enforced before model invocation.
- **Dual-stream:** numbers-intact lines for the deterministic template; number-free `aiLines` for the model.
- Keep the sidecar — fix failure modes at the TS call site.

## Blocking fixes applied (from critic pass)

- **F1 (attribution collision):** one canonical model string `'ai-gated-fallback'` for the sidecar-ran-but-gated event. WI-2.1 does **not** introduce `'local-stats(gated)'`; it depends on WI-1.4 (attribution settled first) and logs `wasGated` separately.
- **F5 (prior-context parse):** WI-3.2 extracts the prior exec summary by parsing the `## Executive Summary` heading (post-WI-1.1 form), **not** `**Executive Summary:**`. WI-3.2 depends on WI-1.1. Extractor covers both old and new layouts.

---

## Phase 1 — De-git-log the template (TS-only, zero AI/network, ship first)

### WI-1.1 — Promote inline-bold pseudo-headings to real `##` headings

- **Owner:** Howard · **Risk:** low · **Files:** `src/utils/sessionReport.ts::composeSessionReport`
- **Change:** Replace `**Executive Summary:**` and `**Global Activity Metrics:**` inline-bold with real `## ` headings. Coherent H1 > H2 > H3 outline.
- **Acceptance:** no `**Executive Summary:**`/`**Global Activity Metrics:**` strings remain; `## Executive Summary` and `## Global Activity Metrics` each on standalone lines; metric bullets still follow their heading; exactly one H1, ≥3 H2.
- **Rollback:** revert two heading lines.
- **Depends on:** —

### WI-1.2 — Invert layout: per-repo story first, metrics secondary

- **Owner:** Howard · **Risk:** low · **Files:** `src/utils/sessionReport.ts::composeSessionReport`
- **Change:** New section order — H1 → `## 🚦 Repository Status Breakdown` → `## Global Activity Metrics` → `## Executive Summary` → App Activity. Reorder pushes only; computation unchanged.
- **Acceptance:** breakdown index < metrics index < exec-summary index; App Activity still last; H1 still first; no content dropped.
- **Rollback:** revert push order.
- **Depends on:** WI-1.1

### WI-1.3 — Strip conventional-commit prefixes in `describe()`, prose-ify first two subjects

- **Owner:** Howard · **Risk:** low · **Files:** `src/utils/sessionReport.ts::describe`
- **Change:** Strip `/^(feat|fix|chore|docs|refactor|test|style|perf|build|ci|revert)(\([^)]*\))?!?:\s*/i`; join first two cleaned subjects with " and "; single subject truncates at 57 + ellipsis as today; empty-subject fallback branches unchanged.
- **Acceptance:** `['feat(ask): add sidebar','fix: PTY lock']` → no `feat(`/`fix:` prefix, contains "and"; `['chore: bump deps']` → `bump deps`; `[]` → tier fallback unchanged.
- **Rollback:** revert to single-subject truncation.
- **Depends on:** —

### WI-1.4 — Add `'ai-gated-fallback'` model attribution

- **Owner:** Leonard · **Risk:** low · **Files:** `src/types.ts::DayNote`, `src/store/dayNotesSlice.ts::fetchExecSummary`
- **Change:** JSDoc the four attribution values (`user`, `local-stats`, `ai-gated-fallback`, `apple/foundation-models`). In `fetchExecSummary`, when `parsed.ok && parsed.body` but `cleaned === EXEC_SUMMARY_FALLBACK`, set `model = 'ai-gated-fallback'` (was `local-stats`). Distinguishes "sidecar ran, output gated" from "sidecar never ran".
- **Acceptance:** gated body → `ai-gated-fallback`; ok:false/throw → `local-stats` (unchanged); surviving body → `parsed.model ?? 'apple/foundation-models'`; `buildAppOnlyNote` still `local-stats`.
- **Rollback:** revert model assignment + JSDoc.
- **Depends on:** —

### WI-1.5 — Replace italic fallback placeholder + neutral empty-note copy

- **Owner:** Howard · **Risk:** low · **Files:** `src/utils/sessionReport.ts`, `src/store/dayNotesSlice.ts::fetchExecSummary`
- **Change:** Replace `EXEC_SUMMARY_FALLBACK` value `'_Apple Intelligence summary unavailable — stats compiled locally._'` with neutral user-vocab copy (e.g. `'Stats compiled from local git data.'`); rename constant `EXEC_SUMMARY_LOCAL`; update all import sites. Replace no-activity error string with neutral dated/info message.
- **Acceptance (critic-rewritten F3):** exported constant lacks `_Apple Intelligence summary unavailable`; no italic markers in fallback exec-summary line; app-only path uses new copy; `sanitizeExecSummary('')` returns `EXEC_SUMMARY_LOCAL` and `fetchExecSummary` then sets `model='ai-gated-fallback'` (stub `invoke`→`{ok:true,body:''}`); TS compiles (all import sites updated).
- **Rollback:** revert rename + string values.
- **Depends on:** WI-1.4

### WI-1.6 — Adaptive scaffold + skip sidecar on single-repo sessions

- **Owner:** Howard · **Risk:** medium · **Files:** `src/utils/sessionReport.ts::composeSessionReport`, `src/store/dayNotesSlice.ts::generateDayNotes`
- **Change:** In `composeSessionReport`, when `activities.length === 1` and tier is `low`/`idle`, emit compact note (H1 + one `describe()`+`statsLabel()` sentence + App Activity). In `generateDayNotes`, when `activeRepoData.length === 1`, **skip the sidecar entirely**, compose exec summary deterministically, set `model='local-stats'`. Prevents the "name 2–4 repos" prompt misfire; preserves P0 (no sidecar on 0 or 1 repo).
- **Acceptance:** 1 repo → `invoke('ai_day_notes')` not called (mock-asserted) and `model==='local-stats'` (critic F4: **not** `ai-gated-fallback` — never invokes sidecar); 1 low-tier repo → no `## 🚦` heading; 1 high-tier repo → full skeleton; ≥2 repos → sidecar called as before.
- **Rollback:** delete both additive branches.
- **Depends on:** WI-1.2, WI-1.3, WI-1.5, **WI-1.4** (critic F4)

---

## Phase 2 — Unblock + measure the AI (eval FIRST)

### WI-2.1 — Eval harness + fixtures + `wasGated` instrumentation

- **Owner:** Amy · **Risk:** low · **Files:** `evals/` (new: README, rubric.ts, run.ts, fixtures/), `src/store/dayNotesSlice.ts::fetchExecSummary`
- **Change:** `evals/` at root. Rubric: Specificity / Accuracy / Gate-pass-rate. 20 JSON fixtures `{ aiLines, rawSidecarOutput, sanitizedOutput, gated }`. `run.ts` scores deterministically. Add `wasGated: boolean` to `fetchExecSummary` return; `console.debug('[day-notes] wasGated:', …)`. **No new persisted type; reuse `'ai-gated-fallback'` from WI-1.4 (critic F1) — do NOT add `'local-stats(gated)'`.**
- **Acceptance (critic F2 split):** harness/schema criteria stay green after WI-2.2; ≥5 fixtures annotated `gated:true` **in the initial commit** (explicitly to be flipped by WI-2.2); `run.ts` runs clean over 20 fixtures; `fetchExecSummary` returns `wasGated`; app-only path unaffected (existing test passes); typecheck+lint clean.
- **Rollback:** delete `evals/`; revert return shape.
- **Depends on:** **WI-1.4** (critic F1)

### WI-2.2 — Narrow `NUMBER_RE` to preserve version/ref tokens

- **Owner:** Howard · **Risk:** medium · **Files:** `src/utils/sessionReport.ts::sanitizeExecSummary`, `src/__tests__/sessionReport.test.ts`
- **Change:** Replace `/\b\d[\d,.]*\b/g` with a pattern stripping count-and-unit numbers but preserving `v2`/`v1.4`, `#42`, `React 19`, `P1`, `S3`. Add `describe('sanitizeExecSummary')` tests. `TIME_SPAN_RE` unchanged.
- **Acceptance:** `'Worked on v2 API and #42 PR fix'` unchanged; `'Shipped 3 bug fixes across 7 files'` → numbers stripped; `'React 19 upgrade landed'` keeps `19`; `P1`/`S3` survive; time-span tests still pass; the ≥5 previously-`gated:true` fixtures flip to `gated:false` (update fixtures); `npm run test`/`lint` clean.
- **Rollback:** restore old `NUMBER_RE` + revert tests + fixture `gated` states.
- **Depends on:** WI-2.1

### WI-2.3 — Enrich `buildAiLines` with digit-free hints

- **Owner:** Howard · **Risk:** low · **Files:** `src/store/githubDayNotes.ts::buildAiLines`
- **Change:** Add 4 digit-free hint categories from already-gathered data: `branch:`, `pr-context:` (number-stripped excerpt ≤80 chars), `dirs:` (top-level dir grouping, no counts), `ci-failure:` (workflow name). No new network/invoke; signature unchanged.
- **Acceptance:** dir/pr-context/ci-failure lines appear for matching fixtures; **no new line contains a bare `\d`** (unit-asserted); `buildContextLines` (numbers-intact) unchanged; empty commits+PRs → only existing digest; downstream `capContextLines(…,8000)` still clamps; test+lint clean.
- **Rollback:** revert to prior `buildAiLines`.
- **Depends on:** WI-2.1

### WI-2.4 — Slim the `@Guide`; move prohibitions to the sanitizer

- **Owner:** Howard · **Risk:** medium · **Files:** `ai-sidecar/Sources/coruro-ai/main.swift` (`SessionSummary` `@Guide`, `buildDayNotesPrompt`)
- **Change:** Cut `@Guide` to what-to-write + format (≤50 words); remove number/time-span/invention prohibitions (sanitizer is authoritative). Trim duplicated prohibition clauses from `buildDayNotesPrompt`. **Wire format (`DayNotesRequest`/`DayNotesResponse`) byte-identical.**
- **Acceptance:** `@Guide` ≤50 words; prompt footer free of "numbers/time span/invent/compute"; structs unchanged; `--selftest` exits 0; `swift build` clean; ≥3 fixtures pass the gate without fallback on re-run; TS tests pass.
- **Rollback (critic F7 standardized):** `git checkout -- ai-sidecar/...main.swift && swift build -c release && cp .build/release/coruro-ai src-tauri/binaries/coruro-ai-aarch64-apple-darwin`.
- **Depends on:** WI-2.1, WI-2.2

---

## Phase 3 — Memory (ceiling-raiser, contract change, last)

### WI-3.1 — Freeze `ai_day_notes` payload schema (`priorContext`)

- **Owner:** Leonard · **Risk:** low · **Files:** `src-tauri/src/commands.rs::ai_day_notes`, `ai-sidecar/Sources/coruro-ai/main.swift::DayNotesRequest`
- **Change:** Doc-comment-only contract freeze: `priorContext` = optional `[String]` (stripped exec-summary sentences, no timestamps/numbers), camelCase key, absent (not null) when empty, Swift defaults missing → `[]`. No runtime change.
- **Acceptance:** matching doc-comments both sides; builds clean; **(critic) WI-3.1 PR merged to main before WI-3.2/WI-3.3 branch from it — branch protection, not just PR text.**
- **Rollback:** revert doc-comment commit.
- **Depends on:** —

### WI-3.2 — TS: build + pass `priorContext`

- **Owner:** Howard · **Risk:** medium · **Files:** `src/store/dayNotesSlice.ts` (`generateDayNotes`, `fetchExecSummary`), `src/store/githubDayNotes.ts`
- **Change:** Before `fetchExecSummary`, take last 2–3 AI notes (`trigger!=='user'`, `model` AI-attributed), **parse the `## Executive Summary` heading (critic F5/F9 — cover both pre-WI-1.1 bold and post-WI-1.1 heading layouts)**, run each through `sanitizeExecSummary`, pass as `priorContext`. Thread into `invoke('ai_day_notes', { repos, priorContext })`. Strings carry no stats/repoRefs/appEvents.
- **Acceptance:** `fetchExecSummary(…, priorContext=[])` default; payload serializes `priorContext`; <2 prior notes → `[]` and call succeeds; prior summary with a digit is stripped; app-only path untouched; no path/repo/commit/appEvents text in `priorContext` (unit-asserted); extractor returns non-empty for **both** layout forms.
- **Rollback:** revert TS; `invoke` falls back to `{repos}` only (old Swift ignores absent field).
- **Depends on:** WI-3.1, **WI-1.1** (critic F5)

### WI-3.3 — Swift: decode `priorContext`, inject into prompt

- **Owner:** Howard · **Risk:** high · **Files:** `ai-sidecar/Sources/coruro-ai/main.swift::DayNotesRequest`, `::buildDayNotesPrompt`
- **Change:** Add `var priorContext: [String] = []` (default → legacy payloads decode). When non-empty, prepend `Prior session notes (for continuity — do not repeat verbatim):` + bullets; add footer clause "do NOT echo/summarise prior notes — continuity only". `@Guide` unchanged. `exceedsContextBudget` already counts the added bytes → overflow degrades to stats-only (existing).
- **Acceptance:** omitted field → `[]`; 2 entries → header + both present; empty → byte-identical to current prompt; budget guard still runs/not bypassed; 3 entries build clean; `@Guide` unchanged.
- **Rollback (critic F7 standardized):** revert Swift; `swift build -c release && cp .build/release/coruro-ai src-tauri/binaries/coruro-ai-aarch64-apple-darwin`. TS/Swift revert independently.
- **Depends on:** WI-3.1

### WI-3.4 — Beverly gate: P0 / invariant review of the memory path

- **Owner:** Beverly · **Risk:** low · **Files:** WI-3.2 + WI-3.3 surfaces
- **Change:** Focused review before merge. Checklist: P0 zero-network (priorContext sanitized, no raw subjects/paths/tokens/appEvents), context-budget accounting, app-only path untouched, sanitizer applied per entry, priorContext empty for local-stats notes.
- **Acceptance (critic F8 — concrete citations required):** P0 PASS citing the `sanitizeExecSummary(...)` call in the prior-context extraction path (dayNotesSlice.ts); context-budget PASS citing `exceedsContextBudget(line)` in main.swift (~L265) with `priorContext` bytes in `line` before the guard; app-only PASS; no open FAILs; PR not merged until Beverly approval recorded.
- **Rollback:** n/a (revert WI-3.2/3.3 per findings).
- **Depends on:** WI-3.2, WI-3.3

### WI-3.5 — Window-coverage label when window > 24h

- **Owner:** Howard · **Risk:** low · **Files:** `src/store/dayNotesWindow.ts::computeWindow`, `src/utils/sessionReport.ts::composeSessionReport`
- **Change:** Add `coverageLabel: string | null` to the window result — `'Covering activity since <date>'` when duration > 24h, else null. `composeSessionReport` renders it as an italic line under the H1 when non-null. Deterministic, no model.
- **Acceptance:** >24h → locale-formatted label; ≤24h → null; label rendered when non-null (asserted on 2nd non-empty line); output unchanged when null; 7-day upper clamp untouched; no `invoke` in changed lines.
- **Rollback:** revert TS; optional param defaults null.
- **Depends on:** —

### WI-3.6 — Lower clamp on `computeWindow` for auto runs

- **Owner:** Howard · **Risk:** low · **Files:** `src/store/dayNotesWindow.ts::computeWindow`, `::shouldSkipAutoRun`
- **Change:** Add optional `trigger: 'auto'|'manual'`; for `auto`, floor `windowStart` at `now - 30min`. Manual unclamped. `shouldSkipAutoRun` unchanged. Thread `trigger` from `generateDayNotes`.
- **Acceptance:** auto + last note 5min ago → windowStart exactly 30min back; manual + 5min ago → 5min back; first run unaffected; 7-day upper clamp still fires; `shouldSkipAutoRun` signature unchanged; **(critic F6) WI-3.5 `coverageLabel` tests still pass with the added `trigger` param.**
- **Rollback:** revert TS; param disappears; call-site back to `(notes, now)`.
- **Depends on:** WI-3.5

---

## Corrected linear merge order (critic-adjudicated)

```
Phase 1:  WI-1.1 → WI-1.3 → WI-1.4 → WI-1.2 → WI-1.5 → WI-1.6
Track A:  WI-3.1 (contract freeze, merge before 3.2/3.3 branch) → WI-3.5 → WI-3.6
Phase 2:  WI-2.1 → { WI-2.2, WI-2.3 parallel } → WI-2.4
Memory:   WI-3.2 ∥ WI-3.3 (after WI-3.1 + WI-1.1) → WI-3.4 (Beverly)
```

Parallelizable tracks: Phase-1 (WI-1.3, WI-1.4 independent of WI-1.1); WI-3.5/3.6 independent of Phase 2; WI-2.2/WI-2.3 parallel after WI-2.1; WI-3.2/WI-3.3 parallel after WI-3.1.

## Recommendation

Land **Phase 1 as one stacked set of small PRs this week** — it's the biggest perceived-quality jump for the least risk and touches zero AI/network. Gate Phase 2 behind WI-2.1 (eval) so prompt/gate changes are measurable. Treat Phase 3 as a deliberate contract change with the Beverly gate; do not start WI-3.2/3.3 until WI-3.1 is merged.
