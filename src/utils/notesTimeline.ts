// notesTimeline.ts — per-repo notes timeline persisted to mygitdash_notes.json.
//
// The JSON file is the source of truth. On every write we ALSO regenerate
// mygitdash_notes.md (a rendered, git-friendly export) so notes travel with
// the repo and render on GitHub. Pure functions (render/seed/parse/factory)
// are unit-tested; the fs wrappers are thin and verified by running the app.

import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { NOTES_FILENAME as LEGACY_MD_FILENAME } from './notesFile';
import type { NotesTimeline, TimelineNote, NoteType } from '../types';

/** Filename for the JSON timeline, written into each repo root. */
export const TIMELINE_FILENAME = 'mygitdash_notes.json';

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
    throw new Error('Invalid mygitdash_notes.json shape');
  }
  return data as NotesTimeline;
}

// --- I/O wrappers implemented in Task 4 ---
