# Context

**Current Task:** Shipped the Setup Curator — a "Curate" sub-tab in the Command Center that judges the scanned `~/.claude` inventory (remove / consolidate / stale findings) with an additive on-device AI narrative.

**Key Decisions:**
- Deterministic findings (TS) render instantly + carry all numbers; AI narrative is additive, number-free, omitted if unavailable.
- Secret-free: model payload carries finding `title` only — Swift `Finding` has no `detail` field. No MCP server; reuses sidecar pattern.
- "Ask Claude to fix" delegates execution to a real Claude session via the Ask bridge; Curator never mutates the setup.

**Next Steps:**
- Manual UI click-through: Curate tab findings render, narrative banner, "Ask Claude to fix" → Ask tab.
- Future: deterministic `gap`/`keep` slice; `cost`/context-budget category.
- Optional: build + replace `/Applications` app with the new sidecar.
