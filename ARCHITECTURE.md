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
   plan-billed and entirely separate from the FoundationModels path. The `--model`
   flag is user-configurable (`Settings.terminalDefaultModel`: Sonnet 5, Opus 4.8,
   or Fable 5), resolved through a Rust whitelist (`resolve_terminal_model`) before
   the CLI is spawned — never interpolated raw into the shell.

The **Publisher** generates social copy through this same plan-billed `claude`
tier — but headless, via `claude -p` over stdio (`publisher.rs`
`run_claude_headless`), not the PTY. It is **not a new boundary**: `claude` is the
user's own already-authorized CLI, so this neither adds nor removes a network path
relative to the on-device FoundationModels sidecar. Generation is **text-only** —
the image renderer that briefly existed in an earlier draft was removed.

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

25 commands. `commands.rs`: `store_token`, `get_token`, `open_in_editor`,
`open_in_terminal`, `git_ahead_behind`, `git_branches`, `git_fetch`,
`git_local_stats`, `git_recent_commits`, `git_commits_since`,
`git_commits_since_numstat`, `git_dirty_stat`, `ai_analyze`, `ai_day_notes`,
`ai_enrich`, `ai_curate`, `detect_repo_type`. `pty.rs`: `pty_spawn`,
`pty_write`, `pty_resize`, `pty_kill`, `pty_spawn_cmd`, `pty_spawn_shell`.
`publisher.rs`: `publisher_open_compose`, `publisher_generate`.

## Publisher

The Publisher is **assisted-manual**: it generates social copy locally (headless
`claude -p`), the user copies a draft, and `publisher_open_compose` opens the
platform's own compose page in the real browser. There is **no auto-posting, no
cookies, no API keys** — the human pastes and clicks post.

Generation is steered by a **Publisher Brief** — multi-select roles (vibe-coder,
founder, CMO, devrel, and more) and a seniority level (set once in Settings and
applied to every draft), plus per-draft audience (30 presets or free text), an
intent preset, guided answers, and free-text guidance — injected as a layered
identity + angle + context block. Guided questions are static templates per intent
(zero extra network calls); an optional "Tailor with AI" step calls the existing
`publisher_generate` command headless to refine the questions — **no new Tauri
command; the IPC count is unchanged at 25**. Each history entry carries its full
Brief, so a saved generation can be **repurposed** (brief restored, variations
cleared) for a different network or format without re-filling. Author voice lives
in `Settings`; the in-flight draft is runtime-only.

Generation is locked down for safety: `claude` runs from a neutral
`std::env::temp_dir()` cwd (never a repo path), with `--disallowedTools` blocking
Bash/Write/Edit/NotebookEdit/WebFetch/WebSearch, and the caller-supplied model is
resolved through a Rust whitelist (`resolve_model`) before any spawn. **No repo
content leaves the machine** except through the user's own already-authorized
`claude` CLI — see [docs/publisher.md](docs/publisher.md).

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
