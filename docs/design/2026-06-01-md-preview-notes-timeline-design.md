# Design — Markdown preview + notes timeline in RepoDetail

**Date:** 2026-06-01
**Status:** Implemented (shipped)
**Area:** `src/components/RepoDetail.tsx`, `src/utils/repoDetail.ts`, new `src/utils/notesTimeline.ts`, `src/types.ts`

## Goal

Reshape the repo detail modal so that:

1. The left pane lists **only markdown (`.md`) files**, recursively, and each is clickable.
2. Clicking a `.md` file renders its preview in the **top** of the right pane (default: the repo README).
3. The bottom of the right pane is a **notes timeline** — discrete, typed notes shown chat-style.
4. A **New note** button appends a note. Notes persist to `<repo>/coruro_notes.json`.
5. The legacy single-textarea `coruro_notes.md` is dropped as an editable field but is still **regenerated as a rendered export** of the timeline, so notes travel with the repo via git and render on GitHub.

## Decisions (from brainstorming)

- **Notes store:** JSON timeline is the source of truth (`<repo>/coruro_notes.json`). `coruro_notes.md` becomes a generated export, not an editable field.
- **Note types:** fixed set — `thought`, `idea`, `todo`, `bug`, `question`. User picks one per note.
- **Markdown tree:** all `.md` files recursively (under the existing entry/depth caps); directories shown only when they lie on the path to a `.md` file.
- **Layout:** right pane split — md preview (top) / notes timeline (bottom), both always visible.
- **State ownership:** timeline state is local to `RepoDetail`, persisted through an isolated `notesTimeline.ts` util (Approach A). Not routed through the zustand store.

## Data model — `src/types.ts` (additions)

```ts
/** Fixed note categories for the per-repo notes timeline. */
export type NoteType = 'thought' | 'idea' | 'todo' | 'bug' | 'question';

/** Ordered list of note types — single source of truth for the type selector. */
export const NOTE_TYPES: readonly NoteType[] = [
  'thought',
  'idea',
  'todo',
  'bug',
  'question',
] as const;

/** One entry in a repo's notes timeline. */
export interface TimelineNote {
  id: string; // crypto.randomUUID()
  type: NoteType;
  body: string;
  createdAt: string; // ISO 8601 (new Date().toISOString())
}

/** Full shape persisted to <repo>/coruro_notes.json. */
export interface NotesTimeline {
  version: 1;
  notes: TimelineNote[];
}
```

## Util — `src/utils/notesTimeline.ts` (new)

Owns the JSON store and the markdown export. Isolated and unit-testable.

- `TIMELINE_FILENAME = 'coruro_notes.json'`
- `readTimeline(repoPath): Promise<NotesTimeline | null>`
  - Read `<repo>/coruro_notes.json`. Return `null` if the file does not exist.
  - On JSON parse error: **throw** a typed error. Callers surface it inline and must NOT overwrite the file (preserve user data).
- `writeTimeline(repoPath, timeline): Promise<void>`
  - Write the JSON file, then regenerate `<repo>/coruro_notes.md` from the timeline.
- `migrateLegacy(repoPath): Promise<NotesTimeline | null>`
  - If no JSON exists but a legacy `coruro_notes.md` exists with non-empty content, return a timeline seeded with a single `thought` note containing that content. Does not write — caller decides when to persist (on first note add, or immediately after migration).
- `renderTimelineMarkdown(timeline, repoName): string`
  - Pure function. Produces the `.md` export. One section per note, **oldest-first** (chronological journal), matching the on-screen timeline order:

    ```
    # Notes — <repoName>

    ## 💭 Thought · 2026-06-01
    <body>

    ## 💡 Idea · 2026-06-01
    <body>
    ```

  - Type → emoji/label map lives here.

Note: writing the JSON and `.md` modifies the working tree, flipping the repo's dirty badge until committed. This is expected and consistent with the existing `notesFile.ts` behavior.

## Util — `src/utils/repoDetail.ts` (modify)

- Add `getMarkdownTree(repoPath): Promise<FileTreeResult>` — same recursive walk as `getFileTree`, but prune to `.md` leaves and the directories on their path. Reuse `MAX_ENTRIES` / `MAX_DEPTH` and the `truncated` flag.
- Add `getMarkdownFile(path): Promise<string>` — read one `.md` file as text for the preview pane.
- Keep `getReadme` (default-selected preview file).

## Component — `src/components/RepoDetail.tsx` (modify)

- **Left pane:** render `getMarkdownTree` result. File rows become buttons; clicking sets `selectedMdPath`. Highlight the active file. The README path is the default selection.
- **Right pane (split, stacked):**
  - **Top — preview:** `ReactMarkdown` + `remarkGfm` of the selected file's content (fetched via `getMarkdownFile`, README via `getReadme`). Read-only.
  - **Bottom — timeline:** scrollable list of note bubbles in **oldest-first** order (newest at the bottom, chat-style), each showing type badge + timestamp + body. A composer row pinned at the bottom with a type selector (`NOTE_TYPES`) + textarea + **New note** button appends a note via `writeTimeline`. Support edit and delete per note.
- **On mount / repo change:** load README, markdown tree, and timeline. If `readTimeline` returns `null`, run `migrateLegacy`. Corrupt JSON → inline error in the timeline pane; do not write.
- Remove the editable `coruro_notes.md` textarea and its `updateNotes` wiring from this component.

## Error handling

- Corrupt `coruro_notes.json` → inline error in the timeline pane; the file is never overwritten while in an error state (no data loss).
- File-write failure on add/edit/delete → inline error; keep the in-memory timeline so the user can retry.
- Missing README / no `.md` files → existing empty-state messaging.

## Out of scope (YAGNI)

- Board-card note counts / badges.
- Note search, filtering, tag-by-free-text, reordering, attachments.
- Routing timeline state through the zustand store.

## Open risks

1. `crypto.randomUUID()` availability in the Tauri webview — verify; fall back to a timestamp+counter id if unavailable.
2. `repoMetadata.notes` (string) in `AppState` is now unused by the UI. Leave the field for back-compat this pass; remove in a later cleanup to avoid a migration in this change.
