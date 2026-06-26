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
