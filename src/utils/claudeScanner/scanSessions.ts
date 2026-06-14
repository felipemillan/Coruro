/**
 * scanSessions.ts — per-project session count scanner for the Claude Command Center.
 * Reads transcript counts and last-modified times; never reads transcript bodies.
 */

import { readDir, exists, stat } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type { ClaudeSessionStat } from '../../types';
import { MAX_SESSION_DIRS } from './shared';

/** Per-project session counts from ~/.claude/projects (transcripts never read). */
export async function scanSessions(projectsDir: string): Promise<ClaudeSessionStat[]> {
  if (!(await exists(projectsDir))) return [];
  const dirs = (await readDir(projectsDir)).filter((e) => e.isDirectory).slice(0, MAX_SESSION_DIRS);

  const stats = await Promise.all(
    dirs.map(async (dir): Promise<ClaudeSessionStat> => {
      let transcriptCount = 0;
      let lastModified: number | null = null;
      try {
        const dirPath = await join(projectsDir, dir.name);
        const files = await readDir(dirPath);
        const jsonlFiles = files.filter((f) => !f.isDirectory && /\.jsonl$/i.test(f.name));
        transcriptCount = jsonlFiles.length;

        // Compute newest mtime across all *.jsonl files in this project dir.
        const mtimes = await Promise.all(
          jsonlFiles.map(async (f): Promise<number | null> => {
            try {
              const filePath = await join(dirPath, f.name);
              const info = await stat(filePath);
              const mtime = info.mtime;
              if (mtime instanceof Date) return mtime.getTime();
              if (typeof mtime === 'number') return mtime;
              return null;
            } catch {
              return null;
            }
          }),
        );

        for (const ms of mtimes) {
          if (ms !== null && (lastModified === null || ms > lastModified)) {
            lastModified = ms;
          }
        }
      } catch {
        // transcriptCount stays 0 (initial value); lastModified stays null
        lastModified = null;
      }
      return { projectSlug: dir.name, transcriptCount, lastModified };
    }),
  );

  return stats;
}
