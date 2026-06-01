// notesFile.ts — read/write per-repo notes as an in-repo mygitdash_notes.md file.
//
// Notes live in `<repo>/mygitdash_notes.md` (plain markdown) so they travel
// with the repository via git and render on GitHub. The dashboard-specific
// filename avoids clobbering a project's own NOTES.md / README. The repo file
// is the source of truth: read on every scan, overriding the central cache.
//
// Writing the file modifies the working tree, so the repo's dirty badge will
// flip until the user commits it — expected, since the point is to commit notes.

import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

/** Filename written into each repo's root. Dashboard-namespaced on purpose. */
export const NOTES_FILENAME = 'mygitdash_notes.md';

/**
 * Read a repo's NOTES.md. Returns the file contents, or null when the file
 * does not exist (so callers can distinguish "no notes file" from "empty").
 */
export async function readRepoNotes(repoPath: string): Promise<string | null> {
  const full = await join(repoPath, NOTES_FILENAME);
  try {
    if (await exists(full)) {
      return await readTextFile(full);
    }
  } catch {
    // Unreadable — treat as absent.
  }
  return null;
}

/** Write a repo's NOTES.md with the given markdown content. */
export async function writeRepoNotes(repoPath: string, notes: string): Promise<void> {
  const full = await join(repoPath, NOTES_FILENAME);
  await writeTextFile(full, notes);
}
