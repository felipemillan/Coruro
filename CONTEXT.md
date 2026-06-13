# Context

**Current Task:** Shipped the Claude Command Center — a "Claude" tab that scans `~/.claude` for an inventory (MCP, skills, plugins, agents, commands, hooks, settings, sessions) with terminal quick-actions and an on-device AI health summary.

**Key Decisions:**
- Read-only + secret-free: env var names only, MCP URLs redacted, transcripts/memory bodies never read.
- Scan fresh on tab open (no persistence, 60s freshness guard); dedicated `useClaudeStore`.
- AI summary reuses the `ai_day_notes` sidecar path — no Swift change; terminal quick-actions via `pendingAskCommand`.

**Next Steps:**
- Validate plugins `config.json` parsing against a real config; tighten counts.
- Optional: raw-shell PTY mode for literal `claude mcp list`; dedicated `claude_health` sidecar prompt.
- Runtime spot-check on macOS (live scan, PTY actions, FoundationModels summary).
