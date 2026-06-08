# Markdown Preview + Notes Timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the RepoDetail modal so the left pane lists only `.md` files (recursive, clickable), the right pane splits into a markdown preview (top) and a typed notes timeline (bottom) persisted to `<repo>/coruro_notes.json` with a regenerated `coruro_notes.md` export.

**Architecture:** Pure logic (markdown export rendering, legacy migration, JSON parse/validate, `.md` tree pruning, note factory) lives in plain functions and is unit-tested with vitest. Filesystem I/O (`@tauri-apps/plugin-fs`) and the React UI are thin wrappers over that logic, verified by launching the app. Timeline state is local to `RepoDetail`, persisted through an isolated `notesTimeline.ts` util (no zustand coupling).

**Tech Stack:** Tauri 2, React 19, TypeScript (strict), Vite, `react-markdown` + `remark-gfm`, `@tauri-apps/plugin-fs`, vitest (new, dev-only).

**Spec:** `docs/superpowers/specs/2026-06-01-md-preview-notes-timeline-design.md`

---

## Model Assignment

Per-task model chosen by complexity / blast radius. Rule: cascading contracts and stateful/UI logic → higher tier; mechanical, exact-spec work → lower tier.

| Task | Model | Why |
|------|-------|-----|
| 1. vitest setup | **haiku 4.5** | Mechanical config + dep install. Zero ambiguity. |
| 2. `types.ts` contracts | **haiku 4.5** | Small, exact, copy from spec. (Shared, but trivial and fully specified below.) |
| 3. `notesTimeline.ts` pure fns + tests | **sonnet 4.6** | Real logic (render/migrate/parse/factory), but well-specified with tests. |
| 4. `notesTimeline.ts` I/O | **sonnet 4.6** | fs wiring + dual-file write. Self-contained, spec exact. |
| 5. `repoDetail.ts` md tree + reader + tests | **sonnet 4.6** | Recursive prune logic + thin fs reader. |
| 6. `RepoDetail.tsx` rework | **opus 4.8** | Stateful UI, split layout, migration-on-load, error handling, edit/delete. High blast radius. |
| 7. Integration verify | **opus 4.8** | Whole-picture: launch app, drive it, screenshot, confirm end-to-end. |

Tasks 3, 4, 5 touch disjoint files and can run concurrently after Task 2. Task 6 depends on 2–5. Task 7 depends on 6.

---

## File Structure

- `package.json` — add `vitest` dev dep + `test` script. *(Task 1)*
- `vitest.config.ts` — **create**, node environment for pure-logic tests. *(Task 1)*
- `src/types.ts` — **modify**: add `NoteType`, `NOTE_TYPES`, `TimelineNote`, `NotesTimeline`. *(Task 2)*
- `src/utils/notesTimeline.ts` — **create**: pure (render/migrate/parse/factory) + I/O (read/write/migrate). *(Tasks 3–4)*
- `src/utils/notesTimeline.test.ts` — **create**: vitest for the pure functions. *(Task 3)*
- `src/utils/repoDetail.ts` — **modify**: add `pruneToMarkdown`, `getMarkdownTree`, `getMarkdownFile`. *(Task 5)*
- `src/utils/repoDetail.test.ts` — **create**: vitest for `pruneToMarkdown`. *(Task 5)*
- `src/components/RepoDetail.tsx` — **modify**: md-only tree, click-to-preview, split right pane, notes timeline. *(Task 6)*

---

## Task 1: vitest setup  ·  **haiku 4.5**

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`
Expected: vitest added to `devDependencies`, exit 0.

- [ ] **Step 2: Add the test script**

In `package.json` `"scripts"`, add:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Add a temporary smoke test and run it**

Create `src/_smoke.test.ts`:

```ts
import { expect, test } from 'vitest';

test('vitest runs', () => {
  expect(1 + 1).toBe(2);
});
```

Run: `npm test`
Expected: PASS, 1 test.

- [ ] **Step 5: Delete the smoke test**

Run: `rm src/_smoke.test.ts`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "test: add vitest for pure-logic unit tests"
```

---

## Task 2: Type contracts  ·  **haiku 4.5**

**Files:**
- Modify: `src/types.ts` (append after the existing `RepoMetadata` type)

- [ ] **Step 1: Add the note types**

Append to `src/types.ts`:

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

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add NoteType, TimelineNote, NotesTimeline contracts"
```

---

## Task 3: notesTimeline pure functions + tests  ·  **sonnet 4.6**

**Files:**
- Create: `src/utils/notesTimeline.ts`
- Create: `src/utils/notesTimeline.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/utils/notesTimeline.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  makeNote,
  renderTimelineMarkdown,
  seedFromLegacy,
  parseTimeline,
} from './notesTimeline';
import type { NotesTimeline } from '../types';

describe('makeNote', () => {
  test('builds a note from parts', () => {
    const n = makeNote('idea', '  hi  ', 'id-1', '2026-06-01T10:00:00.000Z');
    expect(n).toEqual({
      id: 'id-1',
      type: 'idea',
      body: '  hi  ', // body stored verbatim; trimming happens at render
      createdAt: '2026-06-01T10:00:00.000Z',
    });
  });
});

describe('renderTimelineMarkdown', () => {
  test('empty timeline → placeholder', () => {
    const t: NotesTimeline = { version: 1, notes: [] };
    expect(renderTimelineMarkdown(t, 'demo')).toBe(
      '# Notes — demo\n\n_No notes yet._\n',
    );
  });

  test('renders sections oldest-first with type label + date', () => {
    const t: NotesTimeline = {
      version: 1,
      notes: [
        { id: 'a', type: 'thought', body: 'first', createdAt: '2026-06-01T10:00:00.000Z' },
        { id: 'b', type: 'bug', body: 'broke\n', createdAt: '2026-06-02T08:30:00.000Z' },
      ],
    };
    expect(renderTimelineMarkdown(t, 'demo')).toBe(
      '# Notes — demo\n\n' +
        '## 💭 Thought · 2026-06-01\n\nfirst\n\n' +
        '## 🐞 Bug · 2026-06-02\n\nbroke\n',
    );
  });
});

describe('seedFromLegacy', () => {
  test('wraps legacy markdown content in one thought note', () => {
    const t = seedFromLegacy('old notes\n', 'id-9', '2026-06-01T10:00:00.000Z');
    expect(t).toEqual({
      version: 1,
      notes: [{ id: 'id-9', type: 'thought', body: 'old notes', createdAt: '2026-06-01T10:00:00.000Z' }],
    });
  });
});

describe('parseTimeline', () => {
  test('accepts a valid v1 timeline', () => {
    const raw = '{"version":1,"notes":[]}';
    expect(parseTimeline(raw)).toEqual({ version: 1, notes: [] });
  });

  test('throws on wrong version', () => {
    expect(() => parseTimeline('{"version":2,"notes":[]}')).toThrow();
  });

  test('throws on missing notes array', () => {
    expect(() => parseTimeline('{"version":1}')).toThrow();
  });

  test('throws on invalid JSON', () => {
    expect(() => parseTimeline('not json')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/utils/notesTimeline.test.ts`
Expected: FAIL — module `./notesTimeline` not found / exports undefined.

- [ ] **Step 3: Write the pure functions**

Create `src/utils/notesTimeline.ts`:

```ts
// notesTimeline.ts — per-repo notes timeline persisted to coruro_notes.json.
//
// The JSON file is the source of truth. On every write we ALSO regenerate
// coruro_notes.md (a rendered, git-friendly export) so notes travel with
// the repo and render on GitHub. Pure functions (render/seed/parse/factory)
// are unit-tested; the fs wrappers are thin and verified by running the app.

import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { NOTES_FILENAME as LEGACY_MD_FILENAME } from './notesFile';
import type { NotesTimeline, TimelineNote, NoteType } from '../types';

/** Filename for the JSON timeline, written into each repo root. */
export const TIMELINE_FILENAME = 'coruro_notes.json';

/** Display label (emoji + word) per note type — used in the .md export and UI. */
export const TYPE_LABEL: Record<NoteType, string> = {
  thought: '💭 Thought',
  idea: '💡 Idea',
  todo: '✅ Todo',
  bug: '🐞 Bug',
  question: '❓ Question',
};

/** Pure factory. Body is stored verbatim; render-time trims for display. */
export function makeNote(
  type: NoteType,
  body: string,
  id: string,
  createdAt: string,
): TimelineNote {
  return { id, type, body, createdAt };
}

/** Pure. Render the timeline to export markdown, oldest-first. */
export function renderTimelineMarkdown(timeline: NotesTimeline, repoName: string): string {
  const header = `# Notes — ${repoName}\n`;
  if (timeline.notes.length === 0) return `${header}\n_No notes yet._\n`;
  const sections = timeline.notes.map((n) => {
    const date = n.createdAt.slice(0, 10); // YYYY-MM-DD
    return `## ${TYPE_LABEL[n.type]} · ${date}\n\n${n.body.trim()}\n`;
  });
  return `${header}\n${sections.join('\n')}`;
}

/** Pure. Seed a fresh timeline from legacy markdown content. */
export function seedFromLegacy(content: string, id: string, createdAt: string): NotesTimeline {
  return { version: 1, notes: [makeNote('thought', content.trim(), id, createdAt)] };
}

/** Pure. Parse + validate raw JSON into a NotesTimeline. Throws on bad shape. */
export function parseTimeline(raw: string): NotesTimeline {
  const data = JSON.parse(raw) as unknown;
  if (
    typeof data !== 'object' ||
    data === null ||
    (data as { version?: unknown }).version !== 1 ||
    !Array.isArray((data as { notes?: unknown }).notes)
  ) {
    throw new Error('Invalid coruro_notes.json shape');
  }
  return data as NotesTimeline;
}

// --- I/O wrappers implemented in Task 4 ---
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/utils/notesTimeline.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/notesTimeline.ts src/utils/notesTimeline.test.ts
git commit -m "feat(notes): pure timeline render/seed/parse functions + tests"
```

---

## Task 4: notesTimeline I/O wrappers  ·  **sonnet 4.6**

**Files:**
- Modify: `src/utils/notesTimeline.ts` (replace the `// --- I/O wrappers ... ---` marker)

These hit `@tauri-apps/plugin-fs`, so they are verified by running the app in Task 7, not by vitest.

- [ ] **Step 1: Implement the I/O wrappers**

Replace the trailing `// --- I/O wrappers implemented in Task 4 ---` line in `src/utils/notesTimeline.ts` with:

```ts
/**
 * Read a repo's timeline JSON. Returns null when the file is absent.
 * Throws (via parseTimeline) on corrupt JSON — callers surface the error
 * inline and MUST NOT overwrite the file while in an error state.
 */
export async function readTimeline(repoPath: string): Promise<NotesTimeline | null> {
  const full = await join(repoPath, TIMELINE_FILENAME);
  if (!(await exists(full))) return null;
  const raw = await readTextFile(full);
  return parseTimeline(raw);
}

/**
 * Persist the timeline: write the JSON (source of truth) AND regenerate
 * coruro_notes.md as a rendered export. Writing both flips the repo's
 * dirty badge until committed — expected, the point is to commit notes.
 */
export async function writeTimeline(
  repoPath: string,
  repoName: string,
  timeline: NotesTimeline,
): Promise<void> {
  const jsonPath = await join(repoPath, TIMELINE_FILENAME);
  await writeTextFile(jsonPath, `${JSON.stringify(timeline, null, 2)}\n`);
  const mdPath = await join(repoPath, LEGACY_MD_FILENAME);
  await writeTextFile(mdPath, renderTimelineMarkdown(timeline, repoName));
}

/**
 * One-time migration: if no JSON exists but a legacy coruro_notes.md has
 * non-empty content, return a timeline seeded from it. Returns null when there
 * is nothing to migrate. Does NOT write — the caller persists it.
 */
export async function migrateLegacy(
  repoPath: string,
  id: string,
  createdAt: string,
): Promise<NotesTimeline | null> {
  const full = await join(repoPath, LEGACY_MD_FILENAME);
  if (!(await exists(full))) return null;
  const content = (await readTextFile(full)).trim();
  if (content === '') return null;
  return seedFromLegacy(content, id, createdAt);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Re-run unit tests (pure fns still green)**

Run: `npm test -- src/utils/notesTimeline.test.ts`
Expected: PASS (I/O untested here, pure fns unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/utils/notesTimeline.ts
git commit -m "feat(notes): read/write/migrate fs wrappers for timeline + md export"
```

---

## Task 5: Markdown tree + file reader  ·  **sonnet 4.6**

**Files:**
- Modify: `src/utils/repoDetail.ts` (append exports)
- Create: `src/utils/repoDetail.test.ts`

- [ ] **Step 1: Write the failing test for `pruneToMarkdown`**

Create `src/utils/repoDetail.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { pruneToMarkdown } from './repoDetail';
import type { TreeNode } from './repoDetail';

const f = (name: string, path: string): TreeNode => ({ name, path, isDir: false });
const d = (name: string, path: string, children: TreeNode[]): TreeNode => ({
  name, path, isDir: true, children,
});

describe('pruneToMarkdown', () => {
  test('keeps .md leaves, drops non-md leaves', () => {
    const input = [f('README.md', '/r/README.md'), f('main.ts', '/r/main.ts')];
    expect(pruneToMarkdown(input)).toEqual([f('README.md', '/r/README.md')]);
  });

  test('keeps dirs only when they contain a .md descendant', () => {
    const input = [
      d('docs', '/r/docs', [f('guide.md', '/r/docs/guide.md'), f('x.png', '/r/docs/x.png')]),
      d('src', '/r/src', [f('main.ts', '/r/src/main.ts')]),
    ];
    expect(pruneToMarkdown(input)).toEqual([
      d('docs', '/r/docs', [f('guide.md', '/r/docs/guide.md')]),
    ]);
  });

  test('is case-insensitive on the .md extension', () => {
    const input = [f('NOTES.MD', '/r/NOTES.MD')];
    expect(pruneToMarkdown(input)).toEqual([f('NOTES.MD', '/r/NOTES.MD')]);
  });

  test('empty input → empty output', () => {
    expect(pruneToMarkdown([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/repoDetail.test.ts`
Expected: FAIL — `pruneToMarkdown` not exported.

- [ ] **Step 3: Add the functions to `repoDetail.ts`**

Append to `src/utils/repoDetail.ts`:

```ts
/**
 * Pure. Prune a file tree to markdown only: keep `.md` leaves and any
 * directory that has a `.md` descendant (so nesting is preserved). Drops
 * empty directories and non-markdown files.
 */
export function pruneToMarkdown(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (node.isDir) {
      const children = pruneToMarkdown(node.children ?? []);
      if (children.length > 0) out.push({ ...node, children });
    } else if (node.name.toLowerCase().endsWith('.md')) {
      out.push(node);
    }
  }
  return out;
}

/** Build the full tree, then prune to markdown only. Caps/truncation reused. */
export async function getMarkdownTree(repoPath: string): Promise<FileTreeResult> {
  const full = await getFileTree(repoPath);
  return { ...full, root: pruneToMarkdown(full.root) };
}

/** Read one markdown file's text for the preview pane. */
export async function getMarkdownFile(path: string): Promise<string> {
  return readTextFile(path);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/repoDetail.test.ts`
Expected: PASS, all 4 cases.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/utils/repoDetail.ts src/utils/repoDetail.test.ts
git commit -m "feat(detail): markdown-only tree prune + single-file reader + tests"
```

---

## Task 6: RepoDetail rework  ·  **opus 4.8**

**Files:**
- Modify: `src/components/RepoDetail.tsx` (full rewrite of the body; keep the `TreeRow` component and imports it relies on)

This is the high-blast-radius UI task: md-only clickable tree, split right pane (preview / timeline), migration-on-load, add/edit/delete notes, error handling. Verified by running the app in Task 7.

- [ ] **Step 1: Replace `src/components/RepoDetail.tsx` with the reworked component**

```tsx
// RepoDetail.tsx — 85vw × 85vh modal for one repo.
//
// Left pane:  markdown-only file tree (recursive, capped). Rows are clickable.
// Right pane: split — top renders the selected .md (default README); bottom is
//             the notes timeline (typed, chat-style) backed by coruro_notes.json.
//
// Portalled to <body> so the header's backdrop-blur can't clip it.

import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  X,
  FileText,
  Folder,
  FolderOpen,
  File as FileIcon,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  getReadme,
  getMarkdownTree,
  getMarkdownFile,
  type ReadmeResult,
  type FileTreeResult,
  type TreeNode,
} from '../utils/repoDetail';
import {
  readTimeline,
  writeTimeline,
  migrateLegacy,
  makeNote,
  TYPE_LABEL,
} from '../utils/notesTimeline';
import { NOTE_TYPES, type Repo, type NotesTimeline, type NoteType } from '../types';

interface RepoDetailProps {
  repo: Repo;
  onClose: () => void;
}

/** Crypto-random id with a timestamp fallback if randomUUID is unavailable. */
function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `n-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ---------------------------------------------------------------------------
// Recursive tree row — directories toggle, files select.
// ---------------------------------------------------------------------------

function TreeRow({
  node,
  depth,
  expanded,
  toggle,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
  selectedPath: string | null;
  onSelect: (node: TreeNode) => void;
}) {
  const isOpen = expanded.has(node.path);
  const pad = { paddingLeft: `${depth * 14 + 8}px` };

  if (!node.isDir) {
    const active = selectedPath === node.path;
    return (
      <button
        type="button"
        onClick={() => onSelect(node)}
        className={`flex items-center gap-1.5 w-full py-0.5 text-[12px] font-mono truncate text-left transition-colors cursor-pointer ${
          active ? 'bg-sage/20 text-navy' : 'text-navy-light hover:bg-warm-gray'
        }`}
        style={pad}
        title={node.path}
      >
        <FileText size={12} strokeWidth={1.5} className="shrink-0 text-navy-light/50" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => toggle(node.path)}
        className="flex items-center gap-1 w-full py-0.5 text-[12px] text-navy font-mono hover:bg-warm-gray transition-colors cursor-pointer truncate"
        style={pad}
        title={node.path}
      >
        {isOpen ? (
          <ChevronDown size={12} strokeWidth={1.5} className="shrink-0" />
        ) : (
          <ChevronRight size={12} strokeWidth={1.5} className="shrink-0" />
        )}
        {isOpen ? (
          <FolderOpen size={12} strokeWidth={1.5} className="shrink-0 text-sage" />
        ) : (
          <Folder size={12} strokeWidth={1.5} className="shrink-0 text-sage" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isOpen &&
        node.children?.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function RepoDetail({ repo, onClose }: RepoDetailProps) {
  // Preview state
  const [readme, setReadme] = useState<ReadmeResult | null>(null);
  const [tree, setTree] = useState<FileTreeResult | null>(null);
  const [selected, setSelected] = useState<{ name: string; path: string } | null>(null);
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Timeline state
  const [timeline, setTimeline] = useState<NotesTimeline | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [composerType, setComposerType] = useState<NoteType>('thought');
  const [composerBody, setComposerBody] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Load README + markdown tree + timeline on mount / repo change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected(null);
    setPreviewBody(null);
    setTimelineError(null);

    Promise.all([getReadme(repo.path), getMarkdownTree(repo.path)])
      .then(([rm, tr]) => {
        if (cancelled) return;
        setReadme(rm);
        setTree(tr);
        setExpanded(new Set(tr.root.filter((n) => n.isDir).map((n) => n.path)));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Timeline: read JSON; if absent, try migrating legacy .md and persist it.
    (async () => {
      try {
        const existing = await readTimeline(repo.path);
        if (cancelled) return;
        if (existing) {
          setTimeline(existing);
          return;
        }
        const migrated = await migrateLegacy(repo.path, newId(), new Date().toISOString());
        if (cancelled) return;
        if (migrated) {
          await writeTimeline(repo.path, repo.name, migrated);
          if (!cancelled) setTimeline(migrated);
        } else {
          setTimeline({ version: 1, notes: [] });
        }
      } catch (e: unknown) {
        if (!cancelled) setTimelineError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repo.path, repo.name]);

  // Selecting a file loads its body into the preview pane.
  const onSelect = useCallback((node: TreeNode) => {
    setSelected({ name: node.name, path: node.path });
    setPreviewBody(null);
    getMarkdownFile(node.path)
      .then((body) => setPreviewBody(body))
      .catch((e: unknown) => setPreviewBody(`\n> Failed to read file: ${String(e)}\n`));
  }, []);

  // Scroll the timeline to the newest note after it changes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [timeline]);

  // Persist a new timeline value (and the .md export); roll back on failure.
  const persist = useCallback(
    async (next: NotesTimeline) => {
      const prev = timeline;
      setTimeline(next);
      setTimelineError(null);
      try {
        await writeTimeline(repo.path, repo.name, next);
      } catch (e: unknown) {
        setTimeline(prev); // restore in-memory state so nothing is lost
        setTimelineError(e instanceof Error ? e.message : String(e));
      }
    },
    [repo.path, repo.name, timeline],
  );

  const addNote = useCallback(() => {
    const body = composerBody.trim();
    if (body === '' || !timeline) return;
    const note = makeNote(composerType, body, newId(), new Date().toISOString());
    void persist({ ...timeline, notes: [...timeline.notes, note] });
    setComposerBody('');
  }, [composerBody, composerType, timeline, persist]);

  const deleteNote = useCallback(
    (id: string) => {
      if (!timeline) return;
      void persist({ ...timeline, notes: timeline.notes.filter((n) => n.id !== id) });
    },
    [timeline, persist],
  );

  // What the preview pane renders: selected file, else README.
  const previewContent = selected
    ? previewBody
    : (readme?.content ?? null);
  const previewTitle = selected ? selected.name : (readme?.name ?? 'README');

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${repo.name} details`}
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-navy/25"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-[85vw] h-[85vh] bg-cream border border-warm-gray shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-warm-gray border-b border-warm-gray/60 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={14} strokeWidth={1.5} className="text-navy-light shrink-0" />
            <span className="text-[13px] font-semibold text-navy truncate">{repo.name}</span>
            <span className="text-[11px] font-mono text-navy-light/60 truncate">{repo.path}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center w-7 h-7 text-navy-light hover:text-navy hover:bg-navy/10 transition-colors cursor-pointer shrink-0"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body: md tree | (preview / timeline) */}
        <div className="flex flex-1 min-h-0">
          {/* Markdown tree pane */}
          <aside className="w-[280px] shrink-0 border-r border-warm-gray bg-cream/60 flex flex-col min-h-0">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-navy-light/60 border-b border-warm-gray select-none">
              Markdown
              {tree && (
                <span className="ml-2 font-mono normal-case tracking-normal text-navy-light/40">
                  {tree.total}
                  {tree.truncated ? '+ (capped)' : ''}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto py-1">
              {loading ? (
                <p className="px-3 py-2 text-[12px] text-navy-light/50">Loading…</p>
              ) : tree && tree.root.length > 0 ? (
                <>
                  {tree.root.map((node) => (
                    <TreeRow
                      key={node.path}
                      node={node}
                      depth={0}
                      expanded={expanded}
                      toggle={toggle}
                      selectedPath={selected?.path ?? null}
                      onSelect={onSelect}
                    />
                  ))}
                  {tree.truncated && (
                    <p className="px-3 py-2 mt-1 text-[11px] text-terracotta">
                      Tree truncated at the entry cap — large repo.
                    </p>
                  )}
                </>
              ) : (
                <p className="px-3 py-2 text-[12px] text-navy-light/50 italic">
                  No markdown files.
                </p>
              )}
            </div>
          </aside>

          {/* Right: preview (top) + timeline (bottom) */}
          <section className="flex-1 flex flex-col min-h-0">
            {/* Preview */}
            <div className="flex-1 min-h-0 flex flex-col border-b border-warm-gray">
              <div className="shrink-0 px-5 py-2 bg-cream/60 border-b border-warm-gray text-[10px] font-mono text-navy-light/50 truncate select-none">
                {previewTitle}
              </div>
              <div className="flex-1 overflow-auto min-h-0">
                {loading ? (
                  <p className="p-6 text-[13px] text-navy-light/50">Loading…</p>
                ) : error !== null ? (
                  <p className="p-6 text-[13px] text-terracotta font-mono">{error}</p>
                ) : previewContent !== null ? (
                  <div className="markdown-body p-6 max-w-[820px]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewContent}</ReactMarkdown>
                  </div>
                ) : selected && previewBody === null ? (
                  <p className="p-6 text-[13px] text-navy-light/50">Loading file…</p>
                ) : (
                  <p className="p-6 text-[13px] text-navy-light/50 italic">
                    No README found. Pick a markdown file on the left.
                  </p>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className="h-[38%] shrink-0 flex flex-col min-h-0 bg-cream/40">
              <div className="shrink-0 px-5 py-2 flex items-center justify-between border-b border-warm-gray">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-light/60 select-none">
                  Notes timeline
                </span>
                <span className="text-[10px] font-mono text-navy-light/40">coruro_notes.json</span>
              </div>

              {/* Notes list (oldest-first, newest at bottom) */}
              <div ref={scrollRef} className="flex-1 overflow-auto px-5 py-3 space-y-2 min-h-0">
                {timelineError !== null ? (
                  <p className="text-[12px] text-terracotta font-mono">
                    Could not load notes: {timelineError}
                  </p>
                ) : !timeline || timeline.notes.length === 0 ? (
                  <p className="text-[12px] text-navy-light/40 italic">
                    No notes yet. Add a thought, idea, todo, bug, or question below.
                  </p>
                ) : (
                  timeline.notes.map((n) => (
                    <div
                      key={n.id}
                      className="group bg-cream border border-navy/10 px-3 py-2 text-[13px] text-navy"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-sage">
                          {TYPE_LABEL[n.type]}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-navy-light/40">
                            {n.createdAt.slice(0, 16).replace('T', ' ')}
                          </span>
                          <button
                            type="button"
                            onClick={() => deleteNote(n.id)}
                            aria-label="Delete note"
                            className="opacity-0 group-hover:opacity-100 text-navy-light/40 hover:text-terracotta transition cursor-pointer"
                          >
                            <Trash2 size={12} strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{n.body}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Composer */}
              <div className="shrink-0 border-t border-warm-gray px-5 py-2 flex items-end gap-2">
                <select
                  value={composerType}
                  onChange={(e) => setComposerType(e.target.value as NoteType)}
                  aria-label="Note type"
                  className="text-[12px] font-mono bg-cream border border-navy/10 px-2 py-1.5 focus:outline-none focus:border-sage/60 cursor-pointer"
                >
                  {NOTE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <textarea
                  value={composerBody}
                  onChange={(e) => setComposerBody(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      addNote();
                    }
                  }}
                  placeholder="New note… (⌘/Ctrl+Enter to add)"
                  rows={2}
                  className="flex-1 resize-none text-[13px] text-navy font-mono leading-relaxed bg-cream border border-navy/10 px-3 py-2 placeholder:text-navy/30 focus:outline-none focus:border-sage/60 transition-colors"
                  aria-label="New note body"
                />
                <button
                  type="button"
                  onClick={addNote}
                  disabled={composerBody.trim() === ''}
                  className="flex items-center gap-1 text-[12px] font-semibold text-cream bg-navy px-3 py-2 hover:bg-navy-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
                >
                  <Plus size={13} strokeWidth={2} />
                  New note
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (If `useBoardStore`/`updateNotes` show as unused elsewhere, that's fine — they remain used by board cards; this component no longer imports them.)

- [ ] **Step 3: Commit**

```bash
git add src/components/RepoDetail.tsx
git commit -m "feat(detail): md preview pane + typed notes timeline UI"
```

---

## Task 7: Integration verify  ·  **opus 4.8**

**Files:** none (verification only)

The fs wrappers and the React UI aren't unit-tested, so verify the whole feature by driving the app. App launch + screenshot recipe: `npm run tauri dev`, then `screencapture -x -D 2 /tmp/out.png` (the window is on display 2 on this Mac — see the project memory note).

- [ ] **Step 1: Full typecheck + unit tests + production build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc exit 0; vitest all green; vite build succeeds.

- [ ] **Step 2: Launch the app**

Run (background): `npm run tauri dev`
Wait for the log line: `` Running `target/debug/tauri-app` ``.

- [ ] **Step 3: Screenshot + open a repo's detail**

Open a repo card's detail modal (the file/markdown icon on a card). Then:
Run: `screencapture -x -D 2 /tmp/verify-detail.png`
Read `/tmp/verify-detail.png`.
Expected: left pane lists ONLY markdown files (no `.ts`, no `node_modules` noise); right pane shows README on top and a "Notes timeline" section with a composer at the bottom.

- [ ] **Step 4: Verify click-to-preview**

Click a non-README `.md` file in the left tree. Screenshot again to `/tmp/verify-preview.png` and read it.
Expected: the top preview pane now renders the clicked file's content; the file row is highlighted.

- [ ] **Step 5: Verify add-note + persistence**

In the running app, pick a type (e.g. Idea), type a note, click **New note**. Then confirm both files were written:
Run: `ls -la "<repo-path>"/coruro_notes.json "<repo-path>"/coruro_notes.md && cat "<repo-path>"/coruro_notes.json`
Expected: JSON contains the note with `version:1`; the `.md` export shows the rendered `## 💡 Idea · <date>` section.

- [ ] **Step 6: Verify migration (manual, one repo)**

Pick a repo that still has an old hand-written `coruro_notes.md` and NO `coruro_notes.json`. Open its detail.
Expected: the timeline shows one `Thought` note seeded from the old markdown; a `coruro_notes.json` now exists alongside.

- [ ] **Step 7: Verify corrupt-JSON safety**

Run: `echo 'not json' > "<test-repo>/coruro_notes.json"`, open that repo's detail.
Expected: the timeline pane shows "Could not load notes: …"; the file is NOT overwritten (re-`cat` it — still `not json`). Then restore/delete the test file.

- [ ] **Step 8: Commit any fixes**

If Steps 1–7 surfaced bugs, fix them (smallest change), re-run Step 1, and commit:

```bash
git add -A
git commit -m "fix(detail): address integration findings for md preview + timeline"
```

---

## Notes for the executor

- **Concurrency:** Tasks 3, 4, 5 touch disjoint files — safe to run as parallel subagents after Task 2 lands. Task 4 edits the file Task 3 created, so 3 → 4 is sequential; 5 is independent.
- **Style:** match existing Tailwind tokens (`cream`, `sage`, `terracotta`, `navy`, `warm-gray`) and the `rounded-none` base aesthetic. No new design tokens.
- **`repoMetadata.notes`** stays in `AppState` for back-compat this pass (unused by RepoDetail now). Removing it is a separate cleanup.
- **DRY/YAGNI:** no note search, filter, reorder, or board-card counts. Edit-in-place was descoped to delete + add; add an edit affordance only if asked.
