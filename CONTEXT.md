# Context

**Current Task:** Staff-level hardening (ultracode) — COMPLETE. Phases 0–5 done on branch `hardening/phase3` (14 commits, each gate-green). Full `just gate` green: 157 TS + 9 Rust + 5 Swift tests, 0 lint/fmt errors. Scorecard at `docs/audit/SCORECARD.md`. Branch not yet merged/pushed.

**Key Decisions:**

- All 5 P0 invariants PASS (zero-network AI, secret-free Command Center, Keychain-only token, git read-only via `git_fetch` carve-out + boundary test, sidecar <4096 tokens enforced TS+Swift). ADRs in `docs/adr/`.
- Constitution: rules 4,5,6,8,9,10 PASS; 1,2,3,7 PARTIAL (enforced for new code via ESLint suppression-baseline ratchet + clippy; legacy debt baselined).
- Deliberate follow-ups (NOT done): identity-preserving `useBoardStore` slice split + `generateDayNotes` decomposition (highest-risk, own session); remaining >500-LOC files; React component test coverage; 3 dev-tooling npm advisories.

**Next Steps:**

- Merge/push `hardening/phase3` (currently local only); open PR if desired.
- Tackle the deferred god-store slice split + generateDayNotes in a fresh session.
- Triage the 3 high-sev npm dev-dependency advisories.
