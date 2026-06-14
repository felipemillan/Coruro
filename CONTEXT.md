# Context

**Current Task:** Staff-level hardening audit (ultracode). Phases 0-2 DONE, read-only. Artifacts in `docs/audit/`: `INVENTORY.md`, `FINDINGS.md` (28 findings, 2 P0), `REMEDIATION-PLAN.md` (10-step sequence). Phase 3 (implement) not started — no code changed yet.

**Key Decisions:**

- 3 invariants PASS (zero-network AI, secret-free scanner, Keychain-only token). 2 P0: git_fetch breaks "git read-only" → carve-out doc + boundary test (don't remove); 4096-cap soft/untested → shared `estimatePayloadTokens` on all 4 paths + Swift pre-check backstop.
- Gates missing entirely (no eslint/prettier/rustfmt-clippy config/swiftformat/CI). Order: gates first (fmt+clippy cleanup before deny), then P0s, quick wins, then 3 structural refactors.
- Top structural target: unify AiContext (5 copies→1 source via serde + golden contract test, no codegen) + deep `run_sidecar_mode<T>`; split useBoardStore; PTY/sidecar tests.

**Next Steps:**

- Phase 3 wave-1 (low-risk): write gate configs (bodies in workflow `w3skivv07` output), apply 279-line `cargo fmt`, fix 2 clippy warns (commands.rs:58 collapsible_if, :453 .last→.next_back), add `just gate`+CI+toolchain pins.
- Then P0-1 git test, P0-2 estimator, quick wins (5,6,7), structural (8,9,10) — each tests-first, gate-green, on a branch.
- Phase 4 docs (ARCHITECTURE/CONTRIBUTING/ADRs), Phase 5 verify scorecard.
