# MyGITdash

A local desktop dashboard for your GitHub repos — a Kanban board over the repositories on your Mac.

Point it at a root folder, and each repo becomes a card showing its current branch, clean/dirty status, and open PR count. Drag cards across five columns (Inbox · Backlog · Active · Review · Done), jot per-repo notes, and open any repo in VS Code or Finder in one click. Board state and notes persist to disk; your GitHub token is stored in the macOS Keychain, never in plaintext.

## Stack

- **Tauri 2** (Rust shell) + **React 19** + **TypeScript** + **Vite**
- **zustand** state, **@hello-pangea/dnd** drag-and-drop, **Tailwind CSS**
- GitHub PAT in macOS Keychain via the Rust `keyring` crate

## Run

```bash
npm install
npm run tauri dev
```

Build a distributable:

```bash
npm run tauri build
```

## How it works

1. Pick a root directory — MyGITdash scans it for git repos.
2. Each repo lands in **Inbox** as a card (branch, dirty badge, PR count).
3. Drag cards between columns; the layout autosaves.
4. Add notes per repo; open in VS Code or Finder.
5. Add a GitHub token in Settings to raise the API rate limit and fetch PR counts.

See `PLAN.md` for the build architecture and design decisions.
