# Context

**Current Task:** Staff-level hardening (ultracode) — COMPLETE. Phases 0–5 done on branch `hardening/phase3` (14 commits, each gate-green). Full `just gate` green: 157 TS + 9 Rust + 5 Swift tests, 0 lint/fmt errors. Scorecard at `docs/audit/SCORECARD.md`. Branch not yet merged/pushed.

**Key Decisions:**

- All 5 P0 invariants PASS (zero-network AI, secret-free Command Center, Keychain-only token, git read-only via `git_fetch` carve-out + boundary test, sidecar <4096 tokens enforced TS+Swift). ADRs in `docs/adr/`.
- Constitution: rules 4,5,6,8,9,10 PASS; 1,2,3,7 PARTIAL (enforced for new code via ESLint suppression-baseline ratchet + clippy; legacy debt baselined).
- Deliberate follow-ups (NOT done): identity-preserving `useBoardStore` slice split + `generateDayNotes` decomposition (highest-risk, own session); remaining >500-LOC files; React component test coverage; 3 dev-tooling npm advisories.

**State:** Hardening merged to local `main` (gate-green; `npm run build` prod frontend build passes). Push to origin/main NOT done (policy-gated, needs explicit user OK — origin/main still at pre-hardening `55b0669`).

**Workflow `coruro-finish` — attempted + REVERTED.** 7 parallel worktree agents split the oversized files, but worktrees branched from unpushed `origin/main` (`55b0669`, pre-hardening) which lacked `eslint.config.js`; agents lint-checked against no config, so their splits hit 525 ESLint errors (complexity/max-depth/no-explicit-any + react-hooks set-state-in-effect/static-components) on real main, and the useBoardStore split conflicted with the shipped `appStateValidation` extraction. Reverted cleanly; worktrees removed; main untouched. Root cause: never pushed main → stale worktree base. To retry correctly: push main first (so worktrees branch from the hardened tree WITH the eslint config), then re-run — or do the splits per-file with the gate live.

**Next Steps:**

- Decide: push origin/main (needs user OK) then re-run `coruro-finish` on the hardened base, OR accept current hardened state + defer splits.
- npm audit triage (3 high-sev dev advisories).
- Oversized-file splits + god-store split remain follow-ups (see SCORECARD).
