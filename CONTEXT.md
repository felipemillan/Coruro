# Context

**Current Task:** Staff-level hardening (ultracode) — COMPLETE. Phases 0–5 done on branch `hardening/phase3` (14 commits, each gate-green). Full `just gate` green: 157 TS + 9 Rust + 5 Swift tests, 0 lint/fmt errors. Scorecard at `docs/audit/SCORECARD.md`. Branch not yet merged/pushed.

**Key Decisions:**

- All 5 P0 invariants PASS (zero-network AI, secret-free Command Center, Keychain-only token, git read-only via `git_fetch` carve-out + boundary test, sidecar <4096 tokens enforced TS+Swift). ADRs in `docs/adr/`.
- Constitution: rules 4,5,6,8,9,10 PASS; 1,2,3,7 PARTIAL (enforced for new code via ESLint suppression-baseline ratchet + clippy; legacy debt baselined).
- Deliberate follow-ups (NOT done): identity-preserving `useBoardStore` slice split + `generateDayNotes` decomposition (highest-risk, own session); remaining >500-LOC files; React component test coverage; 3 dev-tooling npm advisories.

**In flight:** `hardening/phase3` fast-forward-merged to local `main` (HEAD `3207374`); push to origin/main NOT done (policy-gated, needs explicit user OK). ultracode workflow `coruro-finish` (run `wf_1c6766a4-d7e`, `.claude/workflows/coruro-finish.js`) launched: 7 parallel worktree agents splitting the oversized files (useBoardStore god-store + RepoDetail/CommandCenterTab/claudeScanner/AskTab/Settings/CommandPalette), each returns a TS-gate-green patch or skips. Integrator (main thread) applies green patches sequentially: `git apply` → prune eslint baseline → `just gate` → commit per file.

**Next Steps:**

- On workflow completion: integrate green patches (gate-green commit each), note skipped ones.
- npm audit triage (3 high-sev dev advisories); build app + verify; update SCORECARD.
- Push origin/main once user approves.
