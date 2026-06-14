# Contributing to Coruro

The goal: a new contributor should land a first PR within an hour. Start with
`ARCHITECTURE.md` for the shape of the system, then come back here.

## Prerequisites

- **macOS** (the app and the AI sidecar are macOS-only; the sidecar needs
  macOS 26 + Apple Intelligence for the on-device model).
- **Node** — version pinned in `.nvmrc` (`nvm use`).
- **Rust** — toolchain pinned in `src-tauri/rust-toolchain.toml`.
- **just** — the command runner (`brew install just`).
- Optional, for the sidecar gate: `swiftformat` and `swiftlint`
  (`brew install swiftformat swiftlint`). Absent is fine — those steps skip.

## Setup

```sh
just setup        # npm install + cargo fetch
```

## Run

```sh
npm run tauri dev          # the desktop app (front end + Rust core)
just sidecar-build         # build the on-device AI sidecar into src-tauri/binaries/
just sidecar-smoke         # offline self-test of the sidecar
```

The Swift sidecar is **not committed**; build it locally with `just
sidecar-build` before testing any AI feature.

## The one command that matters

```sh
just gate
```

Run it before every commit. It must be green. It runs:

- **TypeScript** — `tsc --noEmit`, ESLint, Prettier `--check`, Vitest.
- **Rust** — `cargo fmt --check`, `cargo clippy` (deny-level lints).
- **Swift** — `swift build` + `swift test` (+ SwiftFormat/SwiftLint if
  installed); skipped cleanly when the Swift toolchain is absent.

Individual halves: `just gate-ts`, `just gate-rust`, `just gate-swift`.

## Linting & the suppression baseline

ESLint runs with `complexity`, `max-depth`, and `@typescript-eslint/no-explicit-any`
as **errors**. Pre-existing violations are captured in `eslint-suppressions.json`
as a ratcheting baseline: a **new** violation fails the gate, and the baseline
**shrinks** as you clean code up. If a refactor removes a suppressed violation,
`eslint .` will fail with "unused suppressions" — run `npm run lint -- --prune-suppressions`
and commit the smaller baseline. Never add new code to the baseline; fix it.

`max-lines-per-function` and `no-console` (which still allows `console.error` /
`console.warn`) are warnings — React render functions are declarative markup,
not the imperative logic the size rule targets.

## Conventions

- **Commits** — Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`,
  `docs:`, `build:`). Small and reversible; one logical change per commit.
- **Style** — Prettier (TS), `rustfmt` (Rust), SwiftFormat (Swift). Don't
  hand-format; run the formatter.
- **Tests** — pure logic in `src/utils/` is unit-tested with Vitest; Rust logic
  with `cargo test`; sidecar budget logic in `CoruroAICore` with `swift test`.
  Add the test in the same commit as the change.
- **Config files** are protected; change them deliberately, with a reason in the
  commit message.

## The invariants are not negotiable

Before you touch the AI path, the Command Center, token storage, or git
commands, read the "Invariants" section of `ARCHITECTURE.md`. Never weaken one to
make a refactor easier — if a change creates tension with an invariant, flag it
in the PR instead. Several are machine-enforced (the zero-network SwiftLint rule,
`git_boundary_tests`, the 4096-token pre-checks) and will fail the gate.

## Pull requests

- `just gate` is green.
- New behavior has a test; invariant-adjacent changes say how the invariant
  still holds.
- If you touched `ai-sidecar/`, note your local `just sidecar-smoke` result — CI
  cannot build the Swift sidecar.
- Reference the relevant ADR in `docs/adr/` when changing a documented decision,
  or add a new ADR.
