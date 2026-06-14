# Architecture

Coruro is a local-first macOS desktop app for managing many Git repositories: a
board of repo cards, on-device AI summaries, an embedded Claude Code terminal,
and a Command Center for your `~/.claude` setup. It is a Tauri 2 app — a React
front end over a Rust core, with a Swift on-device AI sidecar.

## Stack

| Layer      | Tech                                                                                       | Entry                                     |
| ---------- | ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Front end  | React 19 · TypeScript ~5.8 · Vite 7 · Zustand · Tailwind 4 · cmdk · xterm · react-markdown | `src/main.tsx` → `src/App.tsx`            |
| Core       | Tauri 2 (Rust)                                                                             | `src-tauri/src/main.rs` → `lib.rs::run`   |
| AI sidecar | Swift · FoundationModels (on-device), not committed                                        | `ai-sidecar/Sources/coruro-ai/main.swift` |

## The three boundaries

```
React  ──1. invoke()──▶  Rust (#[tauri::command])  ──2. std::process──▶  Swift coruro-ai
  ▲                          │                          (JSON line over stdin/stdout,
  └──── events / PTY ◀──3────┘                           4 modes: analyze/day_notes/enrich/curate)
```

1. **React → Rust** — `@tauri-apps/api`'s `invoke()` calls the registered
   `#[tauri::command]` functions (`src-tauri/src/lib.rs` `generate_handler!`).
2. **Rust → Swift** — the sidecar is spawned directly with `std::process`
   (`resolve_sidecar` → `run_sidecar` → `run_sidecar_mode` in `commands.rs`), not
   `shell().sidecar()`, which mis-resolved in the release bundle (see
   `docs/adr/0001-std-process-sidecar.md`). A single newline-terminated JSON line
   goes in; one JSON line comes back.
3. **Rust PTY bridge** — `pty.rs` runs the interactive `claude` CLI inside a
   pseudo-terminal; output streams to xterm.js via `pty-output` events. This is
   plan-billed and entirely separate from the FoundationModels path.

## Front-end layering

`src/` is a strict, acyclic, downward DAG:

```
main.tsx → App / components → stores (Zustand) → utils → types / view
```

No store imports a component, no util imports a store. State lives in
`src/store/` (`useBoardStore`, `useClaudeStore`, `useViewStore`); pure logic
lives in `src/utils/` and is where most unit tests point.

## Invariants (P0 — never weaken these)

These are load-bearing guarantees, machine-checked where possible:

1. **The AI path makes zero network calls.** FoundationModels is on-device.
   Enforced by a SwiftLint custom rule banning `URLSession`/`URLRequest`
   (`ai-sidecar/.swiftlint.yml`).
2. **The Command Center is read-only and secret-free** — it captures env-var
   _names_ never values, redacts MCP endpoint tokens, and never reads session
   transcripts or memory.
3. **The GitHub token lives only in the macOS Keychain**, never on disk. Only a
   `hasToken` boolean is persisted (`commands.rs` `store_token`/`get_token`).
4. **Git operations are read-only on the user's repos.** `git_fetch` is the sole
   `git_*` command allowed to touch the network (remote-tracking refs only);
   locked by `git_boundary_tests` in `commands.rs`
   (see `docs/adr/0002-git-fetch-network-carveout.md`).
5. **The sidecar context stays under 4096 tokens**, enforced on all four AI
   payloads in TypeScript and backstopped by a pre-check in every Swift mode
   (`CoruroAICore`; see `docs/adr/0003-context-token-budget.md`).

## IPC command set

22 commands. `commands.rs`: `store_token`, `get_token`, `open_in_editor`,
`open_in_terminal`, `git_ahead_behind`, `git_branches`, `git_fetch`,
`git_local_stats`, `git_recent_commits`, `git_commits_since`,
`git_commits_since_numstat`, `git_dirty_stat`, `ai_analyze`, `ai_day_notes`,
`ai_enrich`, `ai_curate`, `detect_repo_type`. `pty.rs`: `pty_spawn`,
`pty_write`, `pty_resize`, `pty_kill`, `pty_spawn_cmd`.

## Persistence

App state is a single JSON file at `~/.repo_dashboard_state.json`
(`@tauri-apps/plugin-fs`, `BaseDirectory.Home`). It is validated defensively on
load — a corrupt or hand-edited file degrades each slice to its default rather
than crashing (`src/utils/appStateValidation.ts`). The GitHub token is the one
thing that never enters this file.

## Quality gate

`just gate` runs the whole cross-language gate locally: TypeScript
(`tsc` · ESLint · Prettier · Vitest), Rust (`cargo fmt --check` · `clippy`), and
the Swift sidecar (`swift build` · `swift test`, skipped cleanly when the
toolchain is absent). CI (`.github/workflows/ci.yml`) runs the TypeScript and
Rust halves on Ubuntu; the Swift sidecar is excluded because it needs macOS 26 +
FoundationModels, which GitHub-hosted runners do not provide — so any change
under `ai-sidecar/` must note a local `just sidecar-smoke` run in the PR. See
`CONTRIBUTING.md`.
