# Context

**Current Task:** Clean baseline. Perf audit shipped to `main`; app rebuilt + installed. Ready for new bug work.

**Key Decisions:**

- Perf P1–P6 merged to `main` (`88a223c`): async git commands, concurrent subprocesses, pty.rs mutex release, RepoCard memo, enrichAi bounded pool. `/Applications/Coruro.app` rebuilt from release + launched (tauri-app + sidecar verified running).
- Repo cleaned: merged branches `hardening/phase3` + `perf/audit-p1-p6` deleted. Only `main` + `security/audit-s1-s2-csp` (unmerged, parked) remain.
- Security branch `security/audit-s1-s2-csp` parked: CSP runtime-unverified; S1 fs-glob not applied (audit premise wrong). Revisit before merge.

**Next Steps:**

- Start clean on new bugs from `main`.
- Before merging security branch: runtime-verify CSP (DevTools console) + S1 fs-scoping product decision.
