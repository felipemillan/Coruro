# Context

**Current Task:** ASK session persistence + per-session delete + favorites drawer card shipped, committed+pushed to main (`98f9b30`), release app rebuilt and replacing `/Applications/Coruro.app` (running, PID verified). Crew-reviewed (Howard+Raj), Leonard-decomposed.

**Key Decisions:**
- Persist sessions metadata-only via new `chatSessions` AppState slice (dayNotes pattern); reconcile `running`→`ended` on load; keep-until-deleted.
- Delete = inline undo toast (~6s) with deferred PTY kill so running session survives undo window; ordered teardown on expiry.
- Favorites moved navbar→drawer card + single `Favorites (N)` pill; storage unchanged (localStorage), only rendering moved.

**Next Steps:**
- Deferred: H6 collapsible repo-groups; Contrast 3:1 verify (terracotta trash/dots/ring on dark+cream).
- Doc: `docs/ask-sessions.md`. Synthesis: `.scratch/ask-sessions-favorites-review-2026-06-14/`.
