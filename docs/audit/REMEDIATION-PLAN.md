# Coruro Hardening — Remediation Plan (Phase 2)

_Sequenced, low-risk plan turning the 28 audit findings (`FINDINGS.md`) into ordered work. Each step: tests-first → change → gate-green → commit. Nothing reduces coverage or weakens an invariant. Generated from workflow `wf_6852f88c`._

## P0 resolutions (decided)

### P0-1 — `git_fetch` vs "git read-only" invariant

**Decision:** Do NOT remove `git_fetch` (`commands.rs:159-172`, registered `lib.rs:19`) — the sync feature depends on it; removing breaks the "fully functional app" goal. Instead **scope the invariant** with an explicit carve-out:

> `git_fetch` is the SOLE `git_*` command permitted to touch the network; it updates remote-tracking refs / FETCH*HEAD only and never mutates the working tree or HEAD. All other `git*\*` are pure local reads.

**Lock with a test:** Rust table test over every `git_*` arg vector — assert exactly one (`fetch`) is network-reaching; all others in the read-only allow-list `{rev-list, branch, log, status, diff, show}`. Net-strengthens enforcement (any future `git_*` gaining a network/mutating verb fails CI).

### P0-2 — sidecar context <4096 tokens "enforced+tested"

**Decision:** One shared `estimatePayloadTokens()` + `MAX_CONTEXT_TOKENS=4096` in `aiContext.ts`, enforced on **all 4 payload paths** (analyze already; day*notes — replace the separate untested 8000-char cap at `useBoardStore.ts:1120-1125`; enrich — currently uncapped; curate — currently uncapped). Add a **Swift pre-check backstop** in each mode that emits `error:'contextOverflow'` \_before* invoking the model (today it only catches at runtime). Relax no cap.

**Tests:** TS — each of 4 builders caps an oversized + CJK/code-dense fixture under budget; Swift testTarget — each mode's pre-check returns `contextOverflow` without calling the model; keep the existing analyze char-cap test.

## Top-3 structural refactors (before → after)

1. **AiContext / sidecar contract** — shape hand-replicated 5× across 3 langs; the same pattern repeats for all 4 modes both directions; 4 `ai_*` commands are shallow pass-throughs returning raw `String` the TS re-parses (LB#1,#2,#3). **After:** one deep `run_sidecar_mode<T>(mode, body, timeout) -> Result<T, AiError>` owning spawn+timeout+error-classification+deserialization; delete the `json!` literal (`commands.rs:568-576`) → `serde_json::to_value(&context)` (struct's camelCase derive is the single mapping); commands return `Result<AiResult, AiError>` so TS receives typed objects (4 `JSON.parse(...) as AiResult` sites deleted). Cross-language **golden-fixture contract test** fails on drift. _No codegen — rule-of-three says a 6-field struct + golden test is the right altitude._
2. **useBoardStore god store (1209 LOC)** — split into persistence/enrich/dayNotes/chatSessions/settings slice creators (same `useBoardStore` identity + `BoardStore` type); extract pure `dayNotesWindow.ts` + `githubDayNotes.ts` (reuse `ghJson`); move 3 module-global mutables (`autoNotesTimerRef`, `notesSaveTimers`, `writeChain`) into resettable `runtimeEffects.ts`; shrink `generateDayNotes` (277 LOC → ~40); decompose `validateAppState`. _No persisted-state schema/filename change._
3. **PTY/sidecar/IPC tests + dedup** — extract `spawn_pty_reader` + `spawn_in_pty` (dedupe the verbatim reader thread `pty.rs:119-157` vs `255-284`); TS `attachPtyListeners` (AskTab `start` vs `handleRunBuild`); create the Swift Tests target (4 decoders + contextOverflow + encoder); Rust tests for `resolve_sidecar`/`run_sidecar`/the always-`Ok(json-error)` mapping. _PTY concurrency = high-risk, change carefully; migrate `pty_spawn` before `pty_spawn_cmd`._

## Gate configs (exact bodies in workflow output; thresholds below)

| Lang  | Files                                                                                                                                       | Key thresholds / deviations                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS    | `eslint.config.js`, `.prettierrc`, `.editorconfig`                                                                                          | `complexity` ≤10 (error), `max-depth` 3 (error), `max-lines-per-function` 120 **warn** (React JSX render fns are declarative, not the imperative logic the 40-LOC rule targets), `no-console` warn (allow error/warn), `no-explicit-any`/`no-floating-promises` error. Install: `eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh prettier eslint-config-prettier` |
| Rust  | `Cargo.toml [lints]`, `rustfmt.toml`                                                                                                        | `clippy::all = deny`, `pedantic = warn`, `cognitive_complexity = deny` (threshold 25 — cognitive ≠ cyclomatic; match-arm dispatch is idiomatic). **Pre-req:** apply 279-line `cargo fmt` diff + fix 2 warns (`commands.rs:58` collapsible_if, `:453` `.last()`→`.next_back()`) BEFORE committing deny table                                                                                                 |
| Swift | `.swiftformat`, `.swiftlint.yml`                                                                                                            | cyclomatic warn 10/error 15, file_length 500, **custom rule bans `URLSession`/`URLRequest`** (machine-enforces zero-network invariant). Conditional gate (binaries not installed; skips gracefully)                                                                                                                                                                                                         |
| All   | `Justfile` (`just setup`, `just gate`, `just sidecar-build/-smoke`), `.github/workflows/ci.yml`, `rust-toolchain.toml`, `.nvmrc`, `engines` | CI runs TS+Rust on ubuntu; **Swift excluded** (no macOS-26/FoundationModels runner) — local `just sidecar-smoke` required + noted in PR for any `ai-sidecar/` change                                                                                                                                                                                                                                        |

## Ordered sequence (tests-first, each reversible)

| #   | Kind       | Step                                                                                                        | Findings                 | Risk     |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------- | ------------------------ | -------- |
| 1   | P0         | Git read-only carve-out doc + Rust arg-vector boundary test                                                 | P0#1                     | low      |
| 2   | P0         | Shared `estimatePayloadTokens` on all 4 paths + Swift pre-check backstop + tests (creates Swift testTarget) | P0#2, LB#4               | med      |
| 3   | gate       | Formatters/configs land + apply 279-line fmt diff + fix 2 clippy warns (BEFORE deny)                        | QW#4, QW#1               | low      |
| 4   | gate       | `just gate` + CI workflow + toolchain pins                                                                  | QW#5, QW#6               | low      |
| 5   | quick-win  | Recover typed AI error taxonomy in store (stop collapsing to `'generation'`)                                | QW#1                     | low      |
| 6   | quick-win  | Delete `json!` literal on analyze path → `to_value(&context)` (fixture round-trip test first)               | QW#2, LB#1(partial)      | low      |
| 7   | quick-win  | Route swallowed IO/network errors through `ghJson`; surface keychain NoEntry vs error                       | QW#3                     | low      |
| 8   | structural | PTY/sidecar/IPC: `spawn_pty_reader`+`spawn_in_pty`, `attachPtyListeners`, sidecar+Rust tests                | LB#5,#8,#4,#13,#14, QW#9 | **high** |
| 9   | structural | AiContext contract + `run_sidecar_mode<T>` deepening; flip 4 commands to typed return                       | LB#1,#2,#3, QW#2         | **high** |
| 10  | structural | Split `useBoardStore`; extract pure day-notes core; resettable runtime effects                              | LB#6,#7,#9,#15, QW#3     | med      |

**Rationale for order:** P0s + gates first (gates make every later step enforceable; fmt/clippy cleanup precedes deny). Quick wins next (low-risk leverage; #5 de-risks #9's typed flip, #6 starts #9, #7 pre-consolidates the GitHub client #10 reuses). Structural last, each gated behind its tests-first, IPC-contract commit isolated for clean rollback.
