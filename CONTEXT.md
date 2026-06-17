# Context

**Current Task:** Ask-tab terminal overhaul + 10-request feature batch. Committed + pushed to `main`.

**Key Decisions:**

- Ask sidebar rebuilt: pinned "Github" root-dir shell, "+ start new session" chooser (Shell/Claude), repo→session breakdown with absolute date-time stamps. Shell button moved out of the controls row.
- Independent shell sessions via `pty_spawn_shell` (`exec $SHELL -il`), `ChatSession.kind: 'claude'|'shell'` (legacy defaults to claude). Terminal accepts file drag-drop (writes path to PTY via Tauri `onDragDropEvent`).
- Terminal reflow fixed (min-w-0 + overflow-hidden so FitAddon measures real width; isVisible refit-on-show). Board responsive = `grid-cols-[repeat(5,minmax(200px,1fr))]`. Settings gear moved to global header. Health summary removed from Command Center.

**Next Steps:**

- Subagents truncated mid-task repeatedly this session — sidebar/shell work was hand-finished + gate-verified.
- Rebuild + replace `/Applications/Coruro.app` when ready (still on old build).
- Live-test shell sessions + drag-drop in dev (`npm run tauri dev`).
