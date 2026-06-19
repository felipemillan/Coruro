# Daily Notes Bento + Neo-Brutalist UI

Two related front-end changes that ship together: a structured **bento-grid**
renderer for the daily session summary, and an app-wide **Neo-Brutalist** visual
language built on shared CSS primitives. The bento seeded the style; the
primitives then propagated it everywhere.

## 1. Daily Notes bento grid

### Problem

A daily summary note is stored as a single Markdown string (`DayNote.body`,
produced by `composeSessionReport` in `src/utils/sessionReport.ts`) and was
rendered as a flat linear list via `react-markdown`. The user wanted a scannable
dashboard, not a wall of text.

### Approach — parse-on-render, no schema change

The stored note stays Markdown (no migration, no new persisted fields). A pure
parser reconstructs structure at render time:

```
DayNote.body (markdown)  ──parseDailyNote()──►  DailyNoteData  ──►  <DailyNoteBento/>
```

- **`src/utils/parseDailyNote.ts`** — `parseDailyNote(body): DailyNoteData | null`.
  Parses the deterministic shape `composeSessionReport` emits: H1 title + date,
  optional italic coverage label, `## 🚦 Repository Status Breakdown` with
  `### 🔴/🟡/🟢/⚪` tiers, `## Global Activity Metrics`, `## Executive Summary`,
  `## App Activity`. Per-repo stat strings are split into numbers
  (`filesChanged/insertions/deletions/untracked`).
  Returns **`null`** when the body is not a full daily summary — user-written
  notes, or the compact single-repo note (no metrics section) — so the caller
  falls back to plain Markdown.
  `deriveNotables(data)` ranks standout repos by lines touched (honest — a
  notable is just the most significant change, nothing invented).

- **`src/components/DailyNoteBento.tsx`** — presentational. Responsive grid
  (`grid-cols-1 → lg:grid-cols-4`): header block, global-metrics block,
  wide executive-summary card (blockquote), 3-column tier breakdown (full-width
  row), "Specific Notables" + "Idle / Untracked" sidebars, app-activity strip.
  `DailyNoteBentoCard` wraps it with the edit/delete controls.
  Repo names are clickable → `onRepoClick(name)`.

- **`src/components/NotesTab.tsx`** — branches per note: `trigger !== 'user'` and
  `parseDailyNote` succeeds → bento; otherwise the existing Markdown card.
  Repo clicks call `onOpenRepoDetail(path)` (passed from `App`), which sets the
  detail path **and switches to the Board tab** — the detail modal only renders
  inside `Board`, so opening it from Notes must change tabs (done in the event
  handler, never a `setState`-in-effect). This also fixed `@mention` clicks from
  the Notes tab.

### Tests

`src/__tests__/parseDailyNote.test.ts` round-trips real `composeSessionReport`
output (compose → parse → assert), so a format change in either module breaks
the test rather than silently desyncing the renderer.

### Gotcha — stat parsing

The per-repo stat string contains nested parens — `12 insertions(+)`,
`3 deletions(-)`. A lazy `\(([^)]*)\)` capture stops at the first inner `)`;
the parser uses a greedy `\((.+)\)\s*$` to grab the whole outer group.

## 2. Neo-Brutalist design system

### Central primitives (`src/index.css`)

One contract, applied everywhere. Components use these classes and keep their own
padding / layout / color utilities:

| Class | Use |
|-------|-----|
| `.nb-card` | card / panel / modal — `2px` navy border, `12px` radius, cream bg, hard `4px 4px` offset shadow |
| `.nb-card-sm` | nested panel / list item / grid tile — `3px` shadow |
| `.nb-flat` | bordered surface, no shadow (rows, wells) |
| `.nb-btn` | button chrome — border + hard shadow, presses on `:active`. Keep the element's own bg/text/padding |
| `.nb-input` | text input / textarea / select — border + focus hard-shadow |
| `.nb-chip` | pill / badge — border + full radius |

Driven by `--nb-border` / `--nb-shadow*` / `--nb-radius*` CSS variables: tune the
look in one place and it propagates app-wide. Palette is inferred from the design
reference and mapped onto existing tokens (cream surface, navy ink, sage/green +
terracotta/red accents). Tier tints: high `#ffdad6`, moderate `#f6e6a8`,
low `#cdeda3`.

### Coverage

Applied across the app: tab nav, Toolbar, Setup, RepoDetail modal, NotesTab
chrome + NoteEditor, Ask tab (sidebar, terminal controls, quick-cmds dialog),
Command Center (`claude/*` KPI/inventory/detail/sub-tabs + `commandCenter/*`
header/groups/overview/plugin cards), all settings `*Section` inputs, and the
TopActionBar megamenus. The Daily Notes bento was the seed and already matches.

Intentionally untouched: `CommandPalette` (cmdk owns its inline-styled dialog),
`AiBanner` / `SectionHeading` (no card/button chrome), and PTY terminal sizing
classes (`min-w-0` / `overflow-hidden` — they fix xterm reflow).

### ⚠️ Board drag-and-drop caveat

The board (`src/components/Board.tsx`) uses **`@hello-pangea/dnd`**, whose drag
clone is `position: fixed`. The column `<section>` must keep
`bg-cream/60 backdrop-blur-sm` — that filtered ancestor is the containing block
the drag clone positions against. Swapping the section to bare `.nb-card`
(no `backdrop-filter`) **broke card drag between columns**, so `Board.tsx` and
`RepoCard.tsx` are intentionally left on their pre-brutalist styling.

To brutalist the board safely later: **keep `backdrop-blur-sm`**, only add
`border-2 border-navy` + a hard shadow — do **not** apply bare `.nb-card` to the
column section. (Related: `src/main.tsx` intentionally omits `React.StrictMode`
because its double-invoke also breaks this dnd library.)
