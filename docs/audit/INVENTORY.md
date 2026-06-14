# Coruro Hardening Audit — Inventory (Phase 0)

_Factual map of the repo before judging. Read-only. Generated from a 14-agent audit (workflow `wf_a98bfaa8`), every gate actually executed._

## Stack

| Layer      | Tech                                                                         | Entry                                            | LOC            |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------ | -------------- |
| Frontend   | React 19 + TS ~5.8, Vite 7, Zustand, Tailwind 4, cmdk, xterm, react-markdown | `src/main.tsx` (13) → `src/App.tsx` (316)        | ~14,392 TS/TSX |
| Backend    | Tauri 2 (Rust)                                                               | `src-tauri/src/main.rs` (6) → `lib.rs::run` (38) | 1,035 Rust     |
| AI sidecar | Swift, FoundationModels (on-device), not committed                           | `ai-sidecar/Sources/coruro-ai/main.swift` (439)  | 439 Swift      |

## Boundaries (3 surfaces)

```
React (xterm/invoke)
  │ 1. invoke()  @tauri-apps/api
  ▼
Rust (22 #[tauri::command]; 17 commands.rs + 5 pty.rs)
  │ 2. std::process spawn (NOT shell().sidecar()) — resolve_sidecar→run_sidecar, JSON line over stdin/stdout
  ▼
Swift coruro-ai (4 modes: analyze | day_notes | enrich | curate; on-device, zero-network)

  │ 3. PTY bridge: pty.rs runs interactive `claude` CLI in pseudo-terminal (plan-billed), distinct from FoundationModels path
```

**IPC command set (22):** `store_token, get_token, open_in_editor, open_in_terminal, git_ahead_behind, git_branches, git_fetch, git_local_stats, git_recent_commits, git_commits_since, git_commits_since_numstat, git_dirty_stat, ai_analyze, ai_day_notes, ai_enrich, ai_curate, detect_repo_type` (commands.rs) + `pty_spawn, pty_write, pty_resize, pty_kill, pty_spawn_cmd` (pty.rs). Registered in `lib.rs:12-33`.

## Existing quality gates (RAN)

| Lang  | Gate                | Status               | Note                                                                                                               |
| ----- | ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| TS    | `tsc --noEmit`      | PASS exit 0          | tsconfig strict + noUnusedLocals/Params                                                                            |
| TS    | `vitest run`        | PASS exit 0          | 16 files, 145 tests, 468ms                                                                                         |
| Rust  | `cargo build`       | PASS exit 0          | incremental                                                                                                        |
| Rust  | `cargo clippy`      | WARN exit 0, 2 warns | NOT denied (no `-D warnings`/`[lints]`): collapsible_if commands.rs:58, double_ended_iterator_last commands.rs:453 |
| Rust  | `cargo fmt --check` | FAIL exit 1          | 279-line diff — not rustfmt-clean, unenforced                                                                      |
| Swift | `swift build`       | PASS exit 0          | only Swift gate that exists                                                                                        |

**Missing entirely:** any ESLint/Prettier/.editorconfig · any rustfmt.toml/clippy.toml/`[lints]` · any swiftformat/swiftlint (binaries not installed) · `.github/workflows` (no CI) · one-command cross-language gate (`Justfile` only imports crew helpers) · toolchain pins (no rust-toolchain, no .nvmrc, no `engines`). Minor: Cargo package still named `tauri-app`/`tauri_app_lib`, not `coruro`.

## Largest files (rule 2 soft cap ~300–500 LOC)

**Over 500 (hard breach), 9:** useBoardStore.ts 1209 · RepoDetail.tsx 976 · CommandCenterTab.tsx 931 · claudeScanner.ts 846 · commands.rs 701 · AskTab.tsx 718 · Settings.tsx 684 · CommandPalette.tsx 597 · types.ts 501. Within band: TopActionBar.tsx 499. Sidecar main.swift 439 (one undivided module).

**Most-imported TS:** `types` 32, `useBoardStore` 12, `useViewStore` 8, `view` 6, `repoStats` 5.

## Dependency graph

TS `src/` is a **clean acyclic DAG**, strict 5-layer downward: `main.tsx → App/components → stores → utils → types/view`. 0 store→component, 0 util→store, 0 util→component edges. **No cycles** (grep-based; run `npx madge --circular --extensions ts,tsx src` to tool-confirm). Rust is flat 2-module (`mod commands; mod pty;`), no cross-`use`. Minor: `useBoardStore.ts` imports `../utils/dayNotesContext` twice.

## Invariant snapshot (detail in FINDINGS.md)

| #   | Invariant                                    | Verdict                                                                          |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | AI path zero network                         | PASS                                                                             |
| 2   | Command Center read-only + secret-free       | PASS                                                                             |
| 3   | GitHub token only in Keychain                | PASS                                                                             |
| 4   | Git ops read-only on user repos              | P0 — `git_fetch` writes `.git` + hits network                                    |
| 5   | Sidecar context <4096 tokens enforced+tested | P0 — char-proxy on 1 of 4 paths, no token check, Swift only catches not prevents |
