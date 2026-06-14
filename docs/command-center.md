# Claude Command Center

A top-level **"Claude"** tab that scans your local Claude Code setup (`~/.claude`)
and surfaces it as an interactive dashboard — the same idea as Coruro's
GitHub-folder scan, applied to your AI tooling. It answers "what have I actually
installed, and what is it?": MCP servers, skills, subagents, slash commands,
plugins, hooks, settings, global memory, and per-project sessions — across both
your user-level config **and every installed plugin**.

Everything shown is **read-only**, **secret-free**, and traces to a real file under
`~/.claude`. On-device **Apple Intelligence** layers short, clearly-labelled "AI"
blurbs on top; it never invents authoritative data.

---

## 1. What it scans (full scope: user + plugins)

The scanner reads user-level `~/.claude` **and** each enabled plugin's installed
directory, tagging every item with a `source` (`local`/`user`, or the plugin name)
so the UI can group and filter by origin.

| Category           | Sources                                                                                                                        | Notes                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MCP servers**    | `~/.claude.json` (global + `projects[*].mcpServers`), each project's `<path>/.mcp.json`, and every enabled plugin's `mcp.json` | **Deduped by name** (global wins over project) — counts unique servers, not per-project tuples. Transport (stdio/sse/http) inferred. A secret-free `packageHint` (e.g. `@scope/server-x`) is derived from the stdio command + args. |
| **Skills**         | `~/.claude/skills/<dir>/SKILL.md` **+** each enabled plugin's `<installPath>/skills/<dir>/SKILL.md`                            | Name + description from YAML frontmatter. Only the **active** plugin version is read (no stale cached versions).                                                                                                                    |
| **Subagents**      | `~/.claude/agents/*.md` **+** each plugin's `<installPath>/agents/…`                                                           | Handles **both** layouts: flat `agents/x.md` and nested `agents/x/AGENT.md` (e.g. bigbang-crew personas).                                                                                                                           |
| **Slash commands** | `~/.claude/commands/**/*.md` **+** each plugin's `<installPath>/commands/**`                                                   | Depth-guarded walk; names namespaced by subdir.                                                                                                                                                                                     |
| **Plugins**        | `~/.claude/plugins/installed_plugins.json` + `settings.json` `enabledPlugins` + each plugin's `.claude-plugin/plugin.json`     | Name, marketplace, active version, enabled flag, and the **authoritative description** from the plugin manifest.                                                                                                                    |
| **Hooks**          | `settings.json` `hooks` + standalone `*-hook-*` / `stop-hook-*` / `session-start-*` scripts                                    | Event + truncated command preview.                                                                                                                                                                                                  |
| **Settings**       | `settings.json`                                                                                                                | Model, permission allow/deny counts, env var **names** only.                                                                                                                                                                        |
| **Global memory**  | `~/.claude/CLAUDE.md`                                                                                                          | Presence + character count only (body never read).                                                                                                                                                                                  |
| **Sessions**       | `~/.claude/projects/<slug>/*.jsonl`                                                                                            | Transcript **count** + newest transcript **mtime** (`lastModified`) per project. Contents never read.                                                                                                                               |

Plugin content lives under `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`;
the authoritative active version per plugin comes from `installed_plugins.json →
installPath`, so version duplicates in the cache are never double-counted.

---

## 2. The dashboard UI

**Header bar** (left→right): compact **quick-action** icon buttons with labels
(MCP · Hooks · Skills · Commands · Settings), a divider, then **Refresh** (force
re-scan) and **Health summary** (on-device AI). A scanning indicator and terracotta
error strip appear when relevant.

**KPI row** — progress-bar stat cards: MCP (unique), Skills, Agents, Commands,
Plugins (enabled / total), Hooks, Sessions.

**Sub-tab nav** (local state): **Overview · MCP · Skills · Agents · Sessions.**

- **Overview**
  - **Skills by Source** — a hand-rolled SVG donut + a per-source meter list laid
    out in **3 columns** (local, posthog, bigbang-crew-agents, …), hover-synced
    with the donut.
  - **Hooks · Settings · Global Memory** in a **3-column** grid.
  - **Plugins** — a card grid with an **all / enabled / disabled** filter (+ search).
    Each card shows name, version, enabled state, marketplace, the manifest
    **description**, and **content-count pills** (e.g. `62 skills · 13 agents · 8 cmds · 1 mcp`).
  - **AI Health Summary** panel (Markdown) and any **Scan Warnings**.
- **MCP** — search + scope/transport filters; a grid of **MCP cards** (scope,
  transport, source chips; URL **host only**; optional AI blurb labelled "AI").
- **Skills / Agents** — search + source filter; card grids of real frontmatter
  descriptions. Agents tab also lists **Commands**.
- **Sessions** — a table: project (humanized slug), transcript count with a
  proportional activity bar, and **last-modified** (relative time). No invented
  "risk" column.

**Detail modal** — see §5.

---

## 3. Apple Intelligence: health summary + enrichment

Two on-device features, both via the existing FoundationModels sidecar
(`ai-sidecar/`, binary `coruro-ai-aarch64-apple-darwin`). No network, no API key.

### Health summary (`ai_day_notes` mode)

`buildClaudeHealthDigest(inventory)` turns the inventory into a compact, number-light,
secret-free `{ name, commits[] }[]` digest (≤ ~8000 chars) and reuses the existing
`ai_day_notes` sidecar mode. Degrades gracefully when Apple Intelligence is off.

### Enrichment (`enrich` mode — new)

Generates a short, one-sentence blurb for things the scanner can't describe (MCP
servers, session projects).

- **Automatic + background.** After every successful scan, the store fires
  `generateEnrichments()` — there is **no button**.
- **Chunked progress.** Items are processed in chunks of 4; a **bottom progress
  bar** shows `Enriching context — done/total` and auto-hides when finished.
- **In-memory cache.** Ids already enriched are never re-generated; a fresh scan
  resets the cache.
- **Secret-free context.** Each item is reduced to `name · transport · package
<packageHint> · <url-host>` (MCP) or a humanized project name (session). The raw
  MCP `command` and any env/flag values **never** reach the model — the
  `packageHint` extractor rejects flags, `=`-values, and long/random tokens.
- **Sidecar flow:** `useClaudeStore.generateEnrichments()` → Rust
  `ai_enrich(items)` (45 s timeout) → Swift `enrich` branch loops the items through
  a `@Generable` one-sentence schema → `{ ok, blurbs:[{id,text}] }`. Unavailable
  device returns `{ ok:false, error:"unavailable" }` → one non-blocking message,
  never fake text.
- **Honesty.** Every blurb renders behind an **"AI"** pill and is treated as a
  guess, never authoritative config (per the source-verification rule). The
  on-device model knows common packages (github, supabase, …) well and obscure
  custom servers only approximately — hence the label.

---

## 4. Quick actions & caveman-everywhere Ask sessions

The header quick-action buttons dispatch natural-language prompts into the Ask/PTY
terminal via the `pendingAskCommand` signal in `useViewStore`; `App.tsx` flips to the
Ask tab and `AskTab` launches the session.

**Every Ask session** (manual or quick-action) now follows the same boot sequence to
cut token cost:

1. Launch `dgc .` with **no prompt arg** (loads memory / dual-graph context).
2. Wait for claude's **ready marker** (`Claude Code v` banner / the `❯` caret) in the
   cumulative PTY buffer — crucially _not_ the first output, since `dgc` prints
   seconds of scan logs first and early keystrokes would be lost.
3. Send `/caveman:caveman ultra` (activates the ultra-compact mode).
4. After a settle delay, send the user's prompt — if one was given (bare sessions
   just get caveman activated).

Timing constants (`CAVEMAN_SETTLE_MS`, `CAVEMAN_TO_PROMPT_MS`) live in `AskTab.tsx`.

---

## 5. Detail modal

Clicking any **skill / agent / command** card (or an **MCP** card) opens an
85vw × 85vh modal mirroring BOARD's project-detail view (`RepoDetail`):

- **File-backed entities** (skill/agent/command): a left **file tree** of the
  entity's directory and a right pane that renders the selected file as Markdown
  (or plain text). Built on `getFileTree` / `getMarkdownFile` from `utils/repoDetail`.
- **MCP** entries have no backing files, so they show a **config panel** (name,
  scope, transport, source, package, host) plus the AI blurb — still secret-free
  (no raw command).
- Portalled to `<body>`; Esc / backdrop closes.

---

## 6. Privacy

- **Read-only.** The scanner never writes to `~/.claude`.
- **Secret-free.** Env vars are captured by **name only**. MCP endpoint URLs are
  redacted (query/fragment stripped) and the enrichment path further reduces them to
  host-only. The raw MCP `command` is never displayed or sent to the model; the
  `packageHint` is a sanitized package identifier with flags/values stripped.
- **No transcript contents.** Sessions are counted and timestamped, never read.
- **Global memory body** is never stored — only its size.
- All AI runs **on-device**; nothing leaves the machine.

---

## 7. Architecture / key files

| File                                       | Role                                                                                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/claudeScanner.ts`               | `scanClaude(): Promise<ClaudeInventory>` — full-scope read-only scanner (user + enabled plugins), MCP name-dedup, nested-agent + `packageHint` + session `mtime` + plugin-manifest descriptions |
| `src/utils/claudeEnrich.ts`                | `buildEnrichmentItems(inv)` — secret-free items for the on-device enrichment model                                                                                                              |
| `src/utils/claudeHealthContext.ts`         | `buildClaudeHealthDigest(inv)` — secret-free health-summary digest                                                                                                                              |
| `src/store/useClaudeStore.ts`              | Zustand store: `scanClaude`, `generateHealthSummary`, `generateEnrichments` (auto, chunked, `enrichProgress`); in-memory only                                                                   |
| `src/components/CommandCenterTab.tsx`      | Dashboard shell: KPI cards, sub-tabs, plugin cards, bottom bar, detail wiring                                                                                                                   |
| `src/components/claude/KpiCard.tsx`        | Progress-bar stat card                                                                                                                                                                          |
| `src/components/claude/SubTabNav.tsx`      | In-tab segmented navigation                                                                                                                                                                     |
| `src/components/claude/SkillsDonut.tsx`    | SVG donut + 3-column per-source meters                                                                                                                                                          |
| `src/components/claude/FilterBar.tsx`      | Search + segmented filter chips                                                                                                                                                                 |
| `src/components/claude/InventoryCards.tsx` | `McpCard` / `SkillCard` / `AgentCard` (clickable → detail)                                                                                                                                      |
| `src/components/claude/SessionsTable.tsx`  | Sessions table (transcripts + last-modified)                                                                                                                                                    |
| `src/components/claude/ClaudeDetail.tsx`   | 85vw×85vh detail modal (file tree + content, or MCP config)                                                                                                                                     |
| `src/components/AskTab.tsx`                | PTY sessions; unified caveman boot sequence                                                                                                                                                     |
| `ai-sidecar/Sources/coruro-ai/main.swift`  | FoundationModels sidecar: `day_notes` + `enrich` modes                                                                                                                                          |
| `src-tauri/src/commands.rs`                | `ai_day_notes`, `ai_enrich` Tauri commands                                                                                                                                                      |
| `src-tauri/capabilities/default.json`      | fs scope for `~/.claude/**` (read/dir/exists/**stat**)                                                                                                                                          |
| `src/types.ts`                             | `ClaudeInventory` + members, enrichment types                                                                                                                                                   |

**fs scope note:** Tauri's `$HOME/**` glob does not match leading-dot path segments,
so explicit `$HOME/.claude`, `$HOME/.claude/**`, `$HOME/.claude.json`,
`$HOME/**/.mcp.json` entries are required (read-text, read-dir, exists, **stat**).
Without them reads silently fail the scope check.

---

## 8. Data freshness

The inventory is scanned fresh when the tab opens and is **never persisted**. A
60-second freshness guard prevents rescan thrash on rapid tab toggling; **Refresh**
forces a re-scan. Enrichment runs automatically after each scan and caches per-id in
memory for the session.

---

## 9. Known limitations / future work

- Enrichment quality is bounded by the on-device model's world knowledge — obscure
  custom MCP servers get an approximate, AI-labelled guess.
- Plugin/skill counts can drift slightly between scans because the plugin cache is
  live-swept by Claude Code (`~/.claude/plugins/.last_inuse_sweep`).
- Caveman boot timing uses fixed settle delays; very slow machines may need the
  `AskTab.tsx` constants nudged up.
- Possible follow-ons: persist enrichment to disk; a dedicated `claude_health`
  sidecar prompt; inventory diffing to highlight "new since last open."
