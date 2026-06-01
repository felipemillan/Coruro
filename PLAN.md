# Build Plan — Local Repo Dashboard (macOS / Tauri 2.0)

Multi-agent build plan. Each task tagged with model + rationale.
Repo currently empty (only README). Scaffold happens in-place.

## Model assignment policy

- **Opus 4.8 (1M)** — architecture, shared contracts, stateful/concurrent logic, security-sensitive code, debugging/integration, adversarial review. High leverage or high blast radius.
- **Sonnet 4.6** — mechanical scaffolding, config files, straightforward components, styling tokens, simple utils. Well-specified, low-ambiguity work.

Rule: if a mistake propagates to many files or is hard to reverse → Opus. If self-contained and spec is exact → Sonnet.

## Token storage decision

GitHub PAT → **macOS Keychain**, NOT plaintext JSON. JSON `settings.githubToken` field removed; replaced by a boolean `hasToken` flag.
Implementation: Rust `keyring` crate + two Tauri commands `store_token(token)` / `get_token()`. Frontend never persists the raw token to disk.

## Dependency DAG

```
P0 Scaffold ─> P1 Contracts ─> P2 Parallel libs ─> P3 UI ─> P4 Integrate+Verify ─> P5 Review
```

Gates: scaffold must boot before P1. Contracts must exist before P2/P3 (shared types). P2 libs must exist before P3 wires them.

---

## P0 — Scaffold  ·  **Sonnet 4.6**

Mechanical. CLI + config.

- `create-tauri-app` → React + TS + Vite into repo root
- npm deps: `zustand @hello-pangea/dnd lucide-react`
- tailwind: `tailwindcss postcss autoprefixer` + init
- tauri plugins: `fs shell dialog`
- Rust dep for keychain: add `keyring` crate to `src-tauri/Cargo.toml`
- `tauri.conf.json`: `transparent: true`, `decorations: true`, window translucency
- `src-tauri/capabilities/default.json`:
  - `fs:default` scoped to `$HOME/.repo_dashboard_state.json`
  - `shell:default` — allowlist ONLY `git`, `code`, `open` (no shell strings)
  - `dialog:default`

**Accept:** `npm run tauri dev` boots blank translucent window. No type errors.

---

## P1 — Contracts  ·  **Opus 4.8**

Shared interface. Everything imports this. Get wrong → cascades.

- `src/types.ts`: `Settings` (rootDirectory: string|null, hasToken: boolean), `ColumnId` union, `Board` (5 cols of repo-path[]), `RepoMetadata` (notes), runtime `Repo` (name, path, branch, dirty, prCount)
- JSON schema per PRD §6, minus raw token (keychain instead)
- `src-tauri/src/commands.rs`: signatures for `store_token` / `get_token` (keyring) — stubbed, implemented P2

**Accept:** strict TS, zero `any`, all exported. Rust command stubs compile.

---

## P2 — Parallel libs  ·  fan-out (disjoint files, no worktrees)

| # | File | Model | Why |
|---|------|-------|-----|
| A | `src/store/useBoardStore.ts` | **Opus 4.8** | zustand + fs load/save + 500ms debounce + moveCard + race-safe load-before-save. Concurrent logic. |
| B | `src-tauri/src/commands.rs` (impl) | **Opus 4.8** | keychain read/write. Security-sensitive Rust. |
| C | `src/utils/scanner.ts` | **Sonnet 4.6** | readDir + `Command.create('git',[...])` branch/dirty/remote. Spec exact. Arg arrays only — no string concat. |
| D | `src/utils/github.ts` | **Sonnet 4.6** | parse remote url → owner/repo, fetch `/pulls`, count. Self-contained. |
| E | `tailwind.config` + `src/index.css` | **Sonnet 4.6** | indie-pastel tokens: cream `#FDFBF7`, sage, terracotta, navy. `rounded-none` base. |

Disjoint ownership → run concurrent, no merge conflict. All import P1.

**Accept:** each typechecks against contracts. Scanner uses arg arrays (injection-safe). Token never touches JSON.

---

## P3 — UI  ·  pipeline (depends P2)

| File | Model | Why |
|------|-------|-----|
| `src/components/Board.tsx` | **Opus 4.8** | `@hello-pangea/dnd` contexts, onDragEnd → moveCard, reorder edge cases. |
| `src/components/RepoCard.tsx` | **Sonnet 4.6** | name/branch/dirty badge/PR count/VS Code+Finder btns/notes textarea. |
| `src/components/Setup.tsx` | **Sonnet 4.6** | dialog picker → setRoot → trigger scan. |
| `src/components/Settings.tsx` | **Sonnet 4.6** | gear modal: root dir + PAT input (→ store_token). |
| `src/App.tsx` | **Sonnet 4.6** | rootDirectory null → Setup else Board. Mount load. |

**Accept:** components render, props typed, aesthetic matches §5.

---

## P4 — Integrate + Verify  ·  **Opus 4.8**

Wiring + debugging. Needs whole-picture reasoning.

- wire App mount → load state → conditional render
- end-to-end: pick dir → scan → cards in Inbox → drag → JSON persists → notes autosave → PR count fetch
- `tsc --noEmit`, lint, `npm run tauri build` smoke

**Accept:** real dir scans, drag persists, notes save, token in keychain (verify via `security find-generic-password`).

---

## P5 — Adversarial review  ·  parallel lenses

| Lens | Model | Focus |
|------|-------|-------|
| Security | **Opus 4.8** | shell injection (paths → git/code/open), keychain usage, fs scope, capabilities not over-broad |
| Correctness | **Opus 4.8** | dnd reorder, debounce races, load-before-save ordering |
| TS / React | **Sonnet 4.6** | strict types, effect deps, no `any`, modern patterns |

Each returns findings; real ones fed back as fix tasks.

---

## Cost note

~13 agent tasks. Opus on 6 high-leverage (contracts, store, keychain, board, integrate, 2 reviews), Sonnet on 7 mechanical. Balances quality vs spend.

## Open risks

1. `keyring` crate macOS entitlement — may need codesign for Keychain access in packaged build. Verify in P4.
2. `@hello-pangea/dnd` + React 18 StrictMode double-invoke — disable StrictMode or handle.
3. GitHub API rate limit unauth'd (60/hr) — token raises to 5000. Cache PR counts.
