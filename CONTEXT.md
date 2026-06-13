# Context

**Current Task:** Board + Ask tab polish — card UI cleanup, session sidebar, card→Ask navigation.

**Key Decisions:**
- Card stats: commits/branches/last commit for all repos (removed stars/issues/forks).
- Card action row: removed Analyze + Refresh; Terminal → Ask button (navigates via pendingAskPath in viewStore).
- Ask sidebar: sessions grouped by repo, single Terminal instance with buffer replay on switch.

**Next Steps:**
- Roadmap top-5 from crew synthesis (see memory: coruro-roadmap-crew) — SQLite+FTS first.
- Ask phase B: transcript mirror from `~/.claude/projects/<slug>/*.jsonl`.
- Menu bar presence + notifications (roadmap #3).
