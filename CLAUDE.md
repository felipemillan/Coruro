# Coruro — Claude Code Guide

This file loads automatically when Claude Code opens the project. It gives you
the shape of the codebase and the patterns to follow when adding features.

## Architecture in one paragraph

Tauri 2 (Rust) hosts a React 19 + TypeScript frontend. All persistent state is
a single JSON file (`~/.repo_dashboard_state.json`) managed by a Zustand store
composed from slices (`src/store/`). Runtime-only data (the scanned repo list,
GitHub enrichment, AI results) never touches disk. A standalone Swift binary
(`ai-sidecar/`) runs on-device via Apple FoundationModels; the Rust backend
spawns it over stdio. Read `ARCHITECTURE.md` before touching the AI path,
token storage, or Tauri command boundary.

## Key invariants (never weaken these)

- **AI is 100% on-device.** No repo content may reach a network endpoint.
- **GitHub token never touches JSON.** It lives in the macOS Keychain only.
- **Git commands are read-only.** Coruro never mutates a working tree.
- **Command Center is read-only and secret-free.** Env var values are never
  captured; only names.
- **No raw filesystem paths in persisted state.** Use `repoName` (slug) in
  activity events, never `path`.

## How to add a feature

**New card field:**

1. Add to `Repo` in `src/types.ts` (runtime-only, never persisted)
2. Derive display value in `src/utils/repoStats.ts` → `deriveCardData()`
3. Render in `src/components/RepoCard.tsx` or a sub-component under `src/components/card/`

**New persisted setting:**

1. Add to `Settings` in `src/types.ts` + default in `createEmptyAppState()`
2. Add validator in `src/utils/appStateValidation.ts` → `validateSettings()`
3. Add action in `src/store/boardStoreTypes.ts` + implement in `src/store/settingsSlice.ts`
4. Wire UI in `src/components/Settings.tsx`

**New top-level tab:**

1. Add the tab button in `src/components/Toolbar.tsx`
2. Add tab state to `useViewStore` (`src/store/useViewStore.ts`)
3. Create `src/components/MyTab.tsx`
4. Mount in `src/App.tsx` (the tab-switching conditional)

**New Tauri (Rust) command:**

1. Define `#[tauri::command]` in `src-tauri/src/commands.rs`
2. Register in `src-tauri/src/lib.rs` → `.invoke_handler()`
3. Call from TS via `invoke('my_command', { ... })`
4. Add the capability entry in `src-tauri/capabilities/default.json`

## The gate

```bash
just gate          # runs tsc, eslint, prettier, vitest, cargo fmt, clippy, swift build+test
just gate-ts       # TypeScript half only
just gate-rust     # Rust half only
just gate-swift    # Swift sidecar only
```

`just gate` must be green before every commit. CI enforces it.

## Slash commands in this repo

- `/project:add-feature` — guided workflow for adding a new Coruro feature
- `/project:gate` — runs the full gate and summarises any failures

## Useful greps

```bash
# Find all Tauri command definitions
grep -n "#\[tauri::command\]" src-tauri/src/commands.rs

# Find all store actions
grep -n "^\s\+[a-z].*:.*=>" src/store/persistenceSlice.ts
```

<!-- dgc-policy-v11 -->

# Dual-Graph Context Policy

This project uses a local dual-graph MCP server for efficient context retrieval.

## MANDATORY: Always follow this order

1. **Call `graph_continue` first** — before any file exploration, grep, or code reading.

2. **If `graph_continue` returns `needs_project=true`**: call `graph_scan` with the
   current project directory (`pwd`). Do NOT ask the user.

3. **If `graph_continue` returns `skip=true`**: project has fewer than 5 files.
   Do NOT do broad or recursive exploration. Read only specific files if their names
   are mentioned, or ask the user what to work on.

4. **Read `recommended_files`** using `graph_read` — **one call per file**.
   - `graph_read` accepts a single `file` parameter (string). Call it separately for each
     recommended file. Do NOT pass an array or batch multiple files into one call.
   - `recommended_files` may contain `file::symbol` entries (e.g. `src/auth.ts::handleLogin`).
     Pass them verbatim to `graph_read(file: "src/auth.ts::handleLogin")` — it reads only
     that symbol's lines, not the full file.
   - Example: if `recommended_files` is `["src/auth.ts::handleLogin", "src/db.ts"]`,
     call `graph_read(file: "src/auth.ts::handleLogin")` and `graph_read(file: "src/db.ts")`
     as two separate calls (they can be parallel).

5. **Check `confidence` and obey the caps strictly:**
   - `confidence=high` -> Stop. Do NOT grep or explore further.
   - `confidence=medium` -> If recommended files are insufficient, call `fallback_rg`
     at most `max_supplementary_greps` time(s) with specific terms, then `graph_read`
     at most `max_supplementary_files` additional file(s). Then stop.
   - `confidence=low` -> Call `fallback_rg` at most `max_supplementary_greps` time(s),
     then `graph_read` at most `max_supplementary_files` file(s). Then stop.

## Token Usage

A `token-counter` MCP is available for tracking live token usage.

- To check how many tokens a large file or text will cost **before** reading it:
  `count_tokens({text: "<content>"})`
- To log actual usage after a task completes (if the user asks):
  `log_usage({input_tokens: <est>, output_tokens: <est>, description: "<task>"})`
- To show the user their running session cost:
  `get_session_stats()`

Live dashboard URL is printed at startup next to "Token usage".

## Rules

- Do NOT use `rg`, `grep`, or bash file exploration before calling `graph_continue`.
- Do NOT do broad/recursive exploration at any confidence level.
- `max_supplementary_greps` and `max_supplementary_files` are hard caps - never exceed them.
- Do NOT dump full chat history.
- Do NOT call `graph_retrieve` more than once per turn.
- After edits, call `graph_register_edit` with the changed files. Use `file::symbol` notation (e.g. `src/auth.ts::handleLogin`) when the edit targets a specific function, class, or hook.

## Context Store

Whenever you make a decision, identify a task, note a next step, fact, or blocker during a conversation, call `graph_add_memory`.

**To add an entry:**

```
graph_add_memory(type="decision|task|next|fact|blocker", content="one sentence max 15 words", tags=["topic"], files=["relevant/file.ts"])
```

**Do NOT write context-store.json directly** — always use `graph_add_memory`. It applies pruning and keeps the store healthy.

**Rules:**

- Only log things worth remembering across sessions (not every minor detail)
- `content` must be under 15 words
- `files` lists the files this decision/task relates to (can be empty)
- Log immediately when the item arises — not at session end

## Session End

When the user signals they are done (e.g. "bye", "done", "wrap up", "end session"), proactively update `CONTEXT.md` in the project root with:

- **Current Task**: one sentence on what was being worked on
- **Key Decisions**: bullet list, max 3 items
- **Next Steps**: bullet list, max 3 items

Keep `CONTEXT.md` under 20 lines total. Do NOT summarize the full conversation — only what's needed to resume next session.
