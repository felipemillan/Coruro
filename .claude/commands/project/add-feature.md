Guided workflow for adding a new feature to Coruro.

## Step 1 — Classify the feature

Determine which layer(s) this touches:
- **Card display only** → `src/types.ts` (Repo) + `src/utils/repoStats.ts` + `RepoCard.tsx`
- **Persisted setting** → `src/types.ts` (Settings) + `appStateValidation.ts` + store slice + `Settings.tsx`
- **New tab** → `Toolbar.tsx` + `useViewStore.ts` + new component + `App.tsx`
- **New Tauri command** → `src-tauri/src/commands.rs` + `lib.rs` + `capabilities/default.json`
- **AI sidecar extension** → `ai-sidecar/Sources/coruro-ai/main.swift` + Rust caller

## Step 2 — Read the contracts

Before writing any code, read:
- `src/types.ts` — the full AppState/Repo/Settings shapes
- `ARCHITECTURE.md` — invariants and boundary rules
- The relevant slice file under `src/store/`

## Step 3 — Implement

Follow the pattern for the layer identified in Step 1. See CLAUDE.md for the exact file sequence per layer type.

Key rules:
- Add the type change first; let TypeScript errors guide the rest
- Never put runtime-only data in AppState (it gets persisted)
- Always add a validator in `appStateValidation.ts` for any new persisted field
- New Rust commands must have a capability entry — the app will panic at runtime without it

## Step 4 — Gate

```bash
just gate
```

Must be green before committing. Fix any type, lint, or test failures.

## Step 5 — Commit

```
feat(<scope>): <what and why>
```

One logical change per commit. Reference the layer in the scope (e.g. `feat(board)`, `feat(ask)`, `feat(settings)`).
