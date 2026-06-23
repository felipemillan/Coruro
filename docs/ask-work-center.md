# Ask Work Center

The **Ask** tab is Coruro's embedded Claude Code terminal. The Work Center turns
it into a command launchpad: instead of memorizing slash commands, skill names,
or how to call a subagent, you point at what you want and Coruro injects the
right text into the prompt you're typing.

Three surfaces feed off the same `~/.claude` scan (`useClaudeStore`) that powers
the [Command Center](./command-center.md):

1. **Cmd+K Command Palette** — keyboard, spotlight-style, fuzzy search.
2. **Top Action Bar** — always-visible, mouse-first, collapsible megamenu.
3. **Project Run button** — repo-type-aware dev/build launcher.

---

## 1. Top Action Bar

A fixed bar under the controls row, present on every Ask session.

### Collapsed (always on)

```
┌────────────────────────────────────────────────────────────────────┐
│ ⭐pinned  /clear /compact /context /model /review │ Plugins MCP │ … │
│                                          Commands Agents Skills  🔍 ⌄more │
└────────────────────────────────────────────────────────────────────┘
```

- **Favorites** — items you pin (★) in the drawer, persisted in `localStorage`
  (`coruro.topbar.favorites`).
- **Built-in quick row** — curated slash commands: `/clear /compact /context
/model /review`.
- **Category pills** with live counts, ordered to match the drawer flow:
  `Plugins · MCP │ Commands · Agents · Skills`. Click a pill → drawer opens
  scrolled to that group.
- **Search** — focusing or typing opens the drawer and filters every group.
- **⌄ more** — toggles the drawer.

### Expanded drawer — provenance flow

The drawer reads left→right as **"pick a source → invoke what it gives you."**

```
SOURCES              │  INVOCABLES
┌─────────┬────────┐ │ ┌────────┬────────┬──────────────────┐
│ Plugins │  MCP   │ │ │Commands│ Agents │ Skills (2-col)   │
│   14    │   24   │ │ │   15   │   68   │      221         │
└─────────┴────────┘ │ └────────┴────────┴──────────────────┘
   filter / context  │        insert into the prompt
```

- **Sources zone** (fixed 300px): **Plugins** and **MCP**.
  - **Plugin** click → toggles a filter (sets the search query to the plugin
    name; active plugin is highlighted, click again to clear). Every column then
    shows only that plugin's items — the "flow from a plugin to its skills."
  - **MCP** click → inserts a mention scaffold (`Use the <name> MCP to `).
- **Invocables zone** (weighted `1fr / 1.2fr / 2.4fr`): **Commands**, **Agents**,
  **Skills**. Skills is widest and renders as a **2-column card grid** so the
  221-item list stays compact.
- **Sticky group headers** — solid `bg-cream`, `sticky top-0 z-10`, bottom border
  - shadow, so the `PLUGINS · MCP · COMMANDS · AGENTS · SKILLS` labels never
    scroll out of view.
- **Pin** — hover any card → ★ to add/remove it from the favorites quick row.

---

## 2. What each item inserts

The bar and palette **insert text onto the active prompt line without pressing
Enter** (`pty_write` with no trailing `\r`), so you can edit or append arguments
before submitting. (The Cmd+K palette historically auto-ran with `\r`; the bar is
insert-only by design.)

| Type    | Inserted text                     | Why                                                                                  |
| ------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| Skill   | `/dirName ` or `/plugin:dirName ` | slash invocation + space for args                                                    |
| Command | `/name `                          | slash command                                                                        |
| Agent   | `Use the <name> subagent to `     | subagents are **not** slash/`@`-invocable — a prompt scaffold is the correct trigger |
| MCP     | `Use the <name> MCP to `          | MCP tools are implicit; a mention nudges Claude to use them                          |
| Plugin  | _(filters the drawer)_            | plugins aren't directly invocable                                                    |

Insertion targets the currently displayed session (`displayedIdRef`). With no
active session the action is a no-op and the drawer shows a hint to start one.

---

## 3. Project Run button

Next to the controls, shown only when the selected repo's type is known. The Rust
side (`detect_repo_type`) infers the project from filesystem markers and returns a
display label; clicking spawns the dev/build command in its **own** PTY session
(separate from any chat session, so the main conversation is undisturbed).

| Detected | Marker                                   | Command             |
| -------- | ---------------------------------------- | ------------------- |
| Tauri    | `src-tauri/` or `tauri.conf.json`        | `npm run tauri dev` |
| Next.js  | `package.json` with a `next` dependency  | `npm run dev`       |
| Node.js  | `package.json` (with/without dev script) | `npm run dev`       |
| Cargo    | `Cargo.toml` (no `src-tauri/`)           | `cargo run`         |
| Make     | `Makefile`                               | `make`              |

### Shell-injection safety

`pty_spawn_cmd` never interpolates user input into the shell. The frontend sends
only a validated `repo_type` enum string; Rust maps it to a **compile-time
`&'static str`** script and runs it through `/bin/zsh -lc`. Unknown types are
rejected. Session creation holds a single `Mutex` guard across the
duplicate-check → setup → insert (no TOCTOU window).

---

## 4. Files

| File                                | Role                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `src/components/TopActionBar.tsx`   | The bar + drawer; insert builders; favorites                                      |
| `src/components/CommandPalette.tsx` | Cmd+K palette (cmdk)                                                              |
| `src/components/AskTab.tsx`         | `handleInsert` (no-`\r` write), `handlePaletteSelect`, Run button, mounts the bar |
| `src/store/useViewStore.ts`         | `paletteOpen` state                                                               |
| `src/store/useClaudeStore.ts`       | Shared `~/.claude` inventory + AI enrichments                                     |
| `src-tauri/src/commands.rs`         | `detect_repo_type`                                                                |
| `src-tauri/src/pty.rs`              | `pty_spawn_cmd` (run/build), `pty_write` (injection)                              |

---

## 5. Known follow-ups

- Palette still shows the full global inventory unranked; no project-local-first
  ordering yet.
- Agent invocation: scaffold text only — no auto-spawn of a chat session when
  none is active.
- Favorites are global (not per-repo).

---

## 6. Megamenu redesign (2026-06-23)

The Insert and Favorites triggers now open **column megamenus** in one shared
full-width drawer below the bar (`openMenu: 'inventory' | 'favorites' | null` —
opening one closes the other; the old compact favorites popover is gone).

**Insert** — five always-on columns: `Plugins | MCP | Commands | Agents | Skills`
(category pill/tab row removed). Clicking a **Plugin** sets `selectedSource` and
**cross-filters** the other four columns to items whose `source` equals that
plugin name (click again, or the ✕ "Filtered to" chip, to clear). Clicking a
leaf (MCP/Command/Agent/Skill) inserts its invocation as before. Each column
scrolls independently with a live count.

**Favorites** — four columns (`Skills | Agents | Commands | MCP`). Pins still
persist as `{label, text}` only (no schema change); the category column is
**inferred at render** from the invocation text (`Use the X subagent`→agents,
`Use the X MCP`→mcp, `/x` matching a known skill insert→skills, else commands).

**Cross-filter source of truth:** every `ClaudeSkill/Agent/Command/McpServer`
carries `source` = `'local'`/`'user'` or the providing plugin's `name`; that is
the plugin→children link.

Companion polish: Code-tab control row (`AskTerminalPanel.tsx`) controls share a
fixed `h-9` (equal height); the Cmd+K palette (`index.css` `[cmdk-*]`) got more
padding/width.
