# Coruro Hardening — Scorecard (Phase 5)

Final verification of the hardening pass. Clean-tree `just gate` is green across
all three languages: **157 TypeScript** tests (Vitest), **9 Rust** tests
(`cargo test`), **5 Swift** tests (`swift test`), plus `tsc`, ESLint (0 errors),
Prettier, `cargo fmt --check`, and `cargo clippy` (0 errors).

## Coruro invariants

| #   | Invariant                                     | Verdict | Evidence                                                                                         |
| --- | --------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| 1   | AI path makes zero network calls              | PASS    | SwiftLint custom rule bans `URLSession`/`URLRequest` (`ai-sidecar/.swiftlint.yml`)               |
| 2   | Command Center read-only & secret-free        | PASS    | Unchanged this pass; env-var names only, MCP tokens redacted, no transcript/memory reads         |
| 3   | GitHub token only in Keychain                 | PASS    | `store_token`/`get_token`; only `hasToken` persisted; keychain errors now surfaced not swallowed |
| 4   | Git operations read-only on user repos        | PASS    | `git_fetch` carve-out + `git_boundary_tests` source scan (ADR 0002)                              |
| 5   | Sidecar context < 4096 tokens enforced+tested | PASS    | TS caps all 4 payloads + Swift per-mode pre-check + tests both sides (ADR 0003)                  |

All five P0 invariants PASS. The two that were P0-broken at audit time (#4 soft,
#5 partial/untested) are now enforced **and** machine-tested.

## Engineering Constitution

| #   | Rule                                                  | Verdict | Notes                                                                                                           |
| --- | ----------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Small units (fns ≤ ~40 LOC, ≤ 3–4 props)              | PARTIAL | New code complies + enforced; `generateDayNotes` (~277 LOC) and other large fns still queued                    |
| 2   | Bounded files (~300–500 LOC)                          | PARTIAL | 9 files still > 500 LOC; the god-store slice split is a documented follow-up                                    |
| 3   | Cyclomatic ≤ 10 / nesting ≤ 3                         | PASS\*  | Enforced for new code (ESLint `complexity`/`max-depth` errors, clippy `cognitive_complexity`); legacy baselined |
| 4   | Deep modules / narrow interfaces                      | PASS    | `run_sidecar_mode`, `spawn_in_pty`/`spawn_pty_reader`, per-slice validators, `CoruroAICore`                     |
| 5   | DRY the decisions                                     | PASS    | One AiContext mapping (serde), one sidecar-run owner, one PTY reader, one shared token estimator                |
| 6   | Intention-revealing naming · one style · no dead code | PASS    | Prettier + rustfmt + SwiftFormat + ESLint + clippy all enforced in the gate                                     |
| 7   | Tests first-class                                     | PARTIAL | Added Rust/Swift/TS unit tests; React component coverage still thin                                             |
| 8   | Docs live with code                                   | PASS    | ARCHITECTURE.md, CONTRIBUTING.md, 4 ADRs, key docstrings                                                        |
| 9   | Explicit errors / boundaries                          | PASS    | Typed AI error taxonomy (`invoke_failed` vs `generation`), keychain surfacing, single synthetic-error owner     |
| 10  | Automation / one-command cross-language gate          | PASS    | `just gate` (TS+Rust+Swift) + CI (TS+Rust on Ubuntu, Swift gated locally)                                       |

\* Enforced via a ratcheting baseline (ADR 0004): new code must comply; the
existing-violation baseline only shrinks.

## What shipped (this pass)

Branch `hardening/phase3`, 14 commits, each gate-green:

1. Gate foundation — rustfmt/clippy-deny, ESLint + suppression baseline, Prettier,
   EditorConfig, `just gate`, CI, toolchain pins.
2. P0-1 — git read-only boundary doc + source-scan tests.
3. P0-2 — 4096-token budget on all 4 AI paths + Swift pre-check + tests.
4. Quick wins — typed AI error taxonomy, `json!`→`to_value`, keychain error surfacing.
5. Structural — PTY reader/spawn dedup, single `run_sidecar_mode`, AppState
   validator extraction.
6. Docs — ARCHITECTURE, CONTRIBUTING, ADRs, docstrings.

## Deliberate follow-ups (not regressions)

- **Identity-preserving slice split of `useBoardStore`** and the
  **`generateDayNotes` decomposition** (~277 → ~40 LOC) — the highest-risk parts
  of the god-store refactor, best done in their own focused sessions; the
  lower-risk validator extraction landed this pass. Tracked in `REMEDIATION-PLAN.md`.
- **Remaining > 500-LOC files** (RepoDetail, CommandCenterTab, claudeScanner,
  AskTab, Settings, CommandPalette) — split as they are next touched; the
  suppression baseline keeps their complexity from growing.
- **Component-level test coverage** — pure logic is well covered; React component
  tests remain thin.
- `npm install` reported 3 high-severity advisories in dev-only tooling — triage
  separately (not shipped to users).
