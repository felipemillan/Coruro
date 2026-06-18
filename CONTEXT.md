# Context

**Current Task:** Multi-agent perf+security audit (tauri-v2-expert). Perf shipped to main; security on review branch awaiting sign-off.

**Key Decisions:**

- Perf P1–P6 merged to `main` (`88a223c`): git_* commands async + spawn_blocking, git_local_stats/git_dirty_stat concurrent subprocesses, pty.rs mutex released before PTY open, RepoCard React.memo, enrichAi bounded pool. Behavior-preserving; cargo 9/9 + vitest 218/218. `/Applications/Coruro.app` rebuilt + replaced.
- Security on branch `security/audit-s1-s2-csp` (`9b1a3ac`, NOT merged): S2 open_in_editor editor allowlist done; CSP set (runtime-unverified, white-screen risk); S1 fs-glob NOT applied — audit premise wrong (app writes notes into repo dirs + reads repo trees/~/.claude).
- tokio built without `macros` feature → no `tokio::join!`; spawn handles then await sequentially (still overlaps).

**Next Steps:**

- Push: `main` is +2 ahead of origin (+ push `security/audit-s1-s2-csp`).
- Runtime-verify CSP (DevTools console) before merging security branch.
- S1 fs scoping needs product decision (repos-root scope, or deny ~/.ssh ~/.aws ~/.gnupg).
