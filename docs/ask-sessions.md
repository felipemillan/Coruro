# ASK sessions: persistence, delete, favorites card

Shipped `98f9b30` (2026-06-14). Crew-reviewed (Howard + Raj), Leonard-decomposed.

## What changed

Three user-facing fixes to the **Ask** tab:

1. **Sessions persist across restarts** (were in-memory only, lost on reload).
2. **Per-session delete** in the left sidebar, with inline undo.
3. **Favorites** moved out of the navbar into a drawer card (was one always-visible pill per favorite).

## Persistence (metadata-only)

- New `chatSessions` slice on `AppState` (`src/types.ts`) — `{ sessions: ChatSession[] }`.
  `ChatSession = { id, repoPath, repoName, title, startedAt, status, exitCode }`.
- Wired through all **five** serialization sync points in `src/store/useBoardStore.ts`:
  `serialise`, `validateAppState` (filter + return), `load` set, `save` destructure.
  Mirrors the `dayNotes` precedent.
- **Metadata only** — terminal scrollback / transcript is **never** persisted (can be
  large and may contain sensitive conversation content). A restored session opens to a
  synthetic `── restored session (ended) ──` banner instead of a blank terminal.
- **Reconcile on load:** `validateAppState` forces every persisted `running` → `ended`.
  After restart the PTY process is gone (`pty.rs` map is empty on boot), so a live
  affordance would be a lie. Restored sessions are read-only history (no reattach).
- **Retention:** keep until manually deleted — no auto-prune.
- Store actions: `addChatSession`, `updateChatSessionStatus`, `deleteChatSession`; each
  persists via the serialized `writeChain`.

## AskTab

- Sessions are store-backed (single source of truth). Both spawn paths (`start`,
  `handleRunBuild`) and their exit/error transitions route through store actions.
- **Delete:** the row was a `<button>`; refactored to a container with sibling
  **select** + **delete** buttons (no nested interactives — valid HTML / AT-safe).
- **Undo toast** (~6s, `aria-live=polite`, no focus steal). **Kill is deferred** to
  toast expiry, so a *running* PTY survives the undo window and Undo can restore the
  live session. On expiry, ordered teardown: `pty_kill` → quick-action timers →
  event listeners → buffer → store removal → clear active + `term.reset()`. A late
  `pty-exit` for a deleted id is a harmless no-op.
- **Focus return** after delete: next remaining row, else the New button.
- a11y: `<nav aria-label="Sessions">` landmark, `focus-visible` rings, `sr-only`
  running/ended status label, `motion-safe:` pulse.

## Favorites (TopActionBar)

- Favorites now render in a dedicated **drawer card** (leading column) with an empty
  state. The quick row shows a single `Favorites (N)` pill that opens the drawer to
  that column — no more one-pill-per-favorite navbar flooding.
- Storage unchanged (localStorage `coruro.topbar.favorites`) — only rendering moved.
- Drawer disclosure a11y: `role="region"`, `id` + `aria-controls`, Escape closes and
  returns focus to the expander (non-modal, no focus trap).

## Deferred (noted, not done)

- **H6** collapsible repo-groups in the sidebar (delete + keep-until-deleted mitigate
  the long-list graveyard for now).
- **Contrast** manual 3:1 verification: terracotta trash / status dots / focus ring
  on `#1A1C16` + cream (SC 1.4.11).
- Full **transcript replay** (would need a separate per-session file store, not the
  shared state JSON — size + secrets).

Crew synthesis: `.scratch/ask-sessions-favorites-review-2026-06-14/sheldon-synthesis.md`.
