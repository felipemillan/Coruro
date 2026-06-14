# Context

**Current Task:** Staff-level hardening + oversized-file refactor — COMPLETE. Hardening (Phases 0–5) pushed to `origin/main` (`0ac0228`). Oversized-file splits done this run and committed locally (`0a18166`, NOT yet pushed). Full `just gate` green: 157 TS + 9 Rust + 5 Swift tests, 0 lint/fmt errors. App rebuilt + replaced at `/Applications/Coruro.app`.

**Key Decisions:**

- All 5 P0 invariants PASS (zero-network AI, secret-free Command Center, Keychain-only token, git read-only via `git_fetch` carve-out + boundary test, sidecar <4096 tokens enforced TS+Swift). ADRs in `docs/adr/`.
- Oversized-file splits landed via a MODEL-TIERED workflow (Opus god-store, Sonnet ×6) on the pushed hardened base: useBoardStore 1209→48, RepoDetail→450, CommandCenterTab→416, claudeScanner→193, AskTab→272, Settings→154, CommandPalette→311. Behavior-preserving; eslint baseline pruned (debt down). Only `types.ts` (508, declarations) marginally >500.
- Lesson: workflow worktrees branch from the pushed remote — push before running, and exclude `.claude/worktrees` when linting (eslint `.` recurses into them; remove worktrees before gating/pruning).
- npm audit: 3 high-sev esbuild advisories are DEV-only (Deno/Windows-dev-server vectors), not in the shipped bundle; fix = breaking vite@8. Accepted, deferred.

**Next Steps:**

- Push `origin/main` to publish the splits commit `0a18166` (needs user OK — policy-gated).
- Optional: code-split the 1 MB JS bundle (vite manualChunks) + lift `types.ts` under 500; React component test coverage.
