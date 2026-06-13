# Claude Command Center

A top-level **"Claude"** tab that scans your local Claude Code setup and surfaces
it as an at-a-glance inventory — the same idea as Coruro's GitHub-folder scan,
applied to `~/.claude`. It answers "what have I actually installed?": how many MCP
servers, skills, plugins, subagents, slash commands, and hooks you have, plus your
settings, global memory, and per-project session counts.

It also wires in two of the app's existing capabilities: the **Ask/PTY terminal**
(quick-action buttons) and **Apple Intelligence** (an on-device health summary).

## What it scans

Everything is **read-only** and **secret-free** (see [Privacy](#privacy)).

| Category | Source | Notes |
|---|---|---|
| MCP servers | `~/.claude.json` (`mcpServers` + `projects[path].mcpServers`) and each project's checked-in `<path>/.mcp.json` | Merged + deduped by scope+project+name; transport (stdio/sse/http) inferred from config |
| Skills | `~/.claude/skills/<dir>/SKILL.md` | Name + description parsed from YAML frontmatter |
| Subagents | `~/.claude/agents/*.md` | Name + description from frontmatter |
| Slash commands | `~/.claude/commands/**/*.md` | Depth-guarded recursive walk; names namespaced by subdir (e.g. `git/commit`) |
| Plugins | `~/.claude/plugins/config.json` | Defensive parse across known container shapes |
| Hooks | `~/.claude/settings.json` `hooks` + standalone `*-hook-*`, `stop-hook-*`, `session-start-*` scripts in `~/.claude` | Event + truncated command preview |
| Settings | `~/.claude/settings.json` | Model, permission allow/deny/ask counts, env var **names** |
| Global memory | `~/.claude/CLAUDE.md` | Presence + character count only (body never stored) |
| Sessions | `~/.claude/projects/<slug>/*.jsonl` | Transcript **count** per project (contents never read) |

## UI

- **Header** — title, a **Refresh** button (force re-scan), and a **Health summary**
  button (on-device AI). Inline scanning indicator and a terracotta error strip.
- **Overview grid** — count tiles for each category.
- **Per-category sections** — scrollable lists with the metadata above (MCP scope +
  transport chips, descriptions, hook event chips, permission counts, env key names,
  memory size, session transcript counts).
- **AI Health Summary** — rendered Markdown from the on-device model (see below).
- **Quick Actions** — buttons that launch natural-language prompts in the Ask
  terminal ("List my MCP servers", "Summarize my hooks", "Explain my skills",
  "List my commands") plus "Open settings.json" (opens in your configured editor).
- **Scan Warnings** — non-fatal per-source errors, if any.

## Data freshness

The inventory is **scanned fresh when the tab opens** and is **never persisted**.
A 60-second freshness guard prevents rescan thrash on rapid tab toggling; the
Refresh button forces a re-scan. This mirrors how `Repo` data is treated — derived
from on-disk truth, recomputed rather than cached, so counts are never stale.

## Apple Intelligence health summary

Reuses the existing on-device sidecar path (`ai_day_notes` mode) — **no Swift
sidecar change**. `buildClaudeHealthDigest` turns the inventory into a compact,
number-light, secret-free digest shaped as the `{ name, commits[] }[]` payload the
sidecar already accepts (`capContextLines`-bounded to ~8000 chars). It degrades
gracefully: if Apple Intelligence is unavailable, the panel shows a reason instead
of an error.

## Terminal integration

Quick actions reuse the existing Ask/PTY terminal rather than spawning a new one.
A `pendingAskCommand` signal in `useViewStore` (sibling to `pendingAskPath`) carries
`{ cwd, prompt }`; `App.tsx` flips to the Ask tab and `AskTab` launches the session
via an explicit `start({ cwd, prompt })` override (no state-commit race). Because
`pty_spawn` runs `claude` with the prompt as its initial question, quick actions are
phrased as natural-language asks Claude answers about your setup.

## Privacy

Consistent with Coruro's local-first stance:

- **Read-only.** The scanner never writes to `~/.claude`.
- **Secret-free.** Env vars are captured by **name only**, never value. MCP server
  `args` and per-server `env` are not read; MCP endpoint URLs are **redacted**
  (query string / fragment stripped) so an inline token never enters memory.
- **No transcript contents.** Sessions are counted, never read.
- **Global memory body** is never stored — only its size.
- The AI digest sent to the on-device model contains only names and counts.

## Architecture / key files

| File | Role |
|---|---|
| `src/utils/claudeScanner.ts` | `scanClaude(): Promise<ClaudeInventory>` — the read-only scanner; per-category try/catch, `Promise.all` |
| `src/utils/claudeHealthContext.ts` | `buildClaudeHealthDigest(inv)` — secret-free AI digest |
| `src/store/useClaudeStore.ts` | Zustand store: `scanClaude({force?})`, `generateHealthSummary()`; in-memory only |
| `src/components/CommandCenterTab.tsx` | The tab UI |
| `src/store/useViewStore.ts` | `pendingAskCommand` signal for terminal quick-actions |
| `src/components/AskTab.tsx` | Consumes `pendingAskCommand`; `start()` override |
| `src/types.ts` | `ClaudeInventory` and member interfaces; `AiDayNotesRepo` |
| `src-tauri/capabilities/default.json` | fs scope for `~/.claude`, `~/.claude.json`, `**/.mcp.json` |

**fs scope note:** Tauri's `$HOME/**` glob does not match leading-dot path
segments, so explicit `$HOME/.claude`, `$HOME/.claude/**`, `$HOME/.claude.json`,
and `$HOME/**/.mcp.json` entries are required. Without them every read silently
fails the scope check and all categories come back empty with populated `errors[]`.

## Known limitations / future work

- **Plugins** parsing is defensive across several possible `config.json` shapes;
  counts should be validated against a real plugins config and tightened.
- **Hook script detection** is filename-heuristic (`*-hook-*`, `stop-hook-*`,
  `session-start-*`); unconventionally named scripts referenced only from
  `settings.json` still appear via the settings path.
- Possible follow-ons: a raw-shell PTY mode for literal `claude mcp list` output;
  a dedicated `claude_health` sidecar prompt; diffing the inventory across scans to
  highlight "new since last open."
