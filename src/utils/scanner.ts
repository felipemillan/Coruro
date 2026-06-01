/**
 * scanner.ts — filesystem + git scanner for MyGITdash.
 *
 * Reads one level of subdirectories under `root`, checks each for a `.git`
 * directory, then collects branch / dirty-state / remote-url via git.
 *
 * SECURITY: every git invocation uses arg arrays passed to Command.create().
 * No string concatenation is ever used to build shell arguments.
 *
 * Runtime type: Repo (from src/types.ts). prCount defaults to 0 here;
 * the GitHub API fetch (github.ts, P2-D) enriches it later.
 */

import { readDir, exists } from '@tauri-apps/plugin-fs';
import { Command } from '@tauri-apps/plugin-shell';
import { join } from '@tauri-apps/api/path';
import type { Repo } from '../types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command with an explicit arg array inside `cwd`.
 * Returns trimmed stdout, or null on non-zero exit or error.
 * Never concatenates user-supplied strings into a shell.
 */
async function runGit(
  name: string,
  args: string[],
  cwd: string,
): Promise<string | null> {
  try {
    // `name` is the scope-entry identifier (capabilities/default.json), not the
    // binary. Each fixed git arg-shape has its own pinned scope entry, so the
    // caller must pass the matching entry name (e.g. 'git-status').
    const output = await Command.create(name, args, { cwd }).execute();
    if (output.code !== 0) return null;
    return output.stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Return the current branch name for the repo at `repoPath`.
 * Falls back to the empty string if the repo is in a detached-HEAD state
 * or any error occurs.
 */
export async function getBranch(repoPath: string): Promise<string> {
  const result = await runGit('git-branch', ['branch', '--show-current'], repoPath);
  return result ?? '';
}

/**
 * Return true if the working tree has any uncommitted changes.
 * Uses `git status --porcelain` — non-empty output means dirty.
 */
export async function getDirty(repoPath: string): Promise<boolean> {
  const result = await runGit('git-status', ['status', '--porcelain'], repoPath);
  // null → git failed (treat as clean to avoid false positives)
  // '' → clean
  // any other string → dirty
  return result !== null && result.length > 0;
}

/**
 * Return the remote.origin.url for the repo at `repoPath`, or null if
 * there is no origin configured.
 */
export async function getRemoteUrl(repoPath: string): Promise<string | null> {
  return runGit('git-remote-url', ['config', '--get', 'remote.origin.url'], repoPath);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan one level of subdirectories under `root` for git repositories.
 *
 * For each subdirectory that contains a `.git` entry, the function collects:
 *   - name    — the directory name
 *   - path    — absolute path (as provided by readDir + join)
 *   - branch  — current branch (empty string in detached-HEAD / error)
 *   - dirty   — whether the working tree has uncommitted changes
 *   - prCount — always 0 here; enriched by github.ts after scan
 *
 * Entries that fail any git call are still included with safe defaults so
 * that a single broken repo does not abort the whole scan.
 *
 * @param root  Absolute path of the parent directory to scan.
 * @returns     Array of Repo objects, one per git repository found.
 */
export async function scanRepos(root: string): Promise<Repo[]> {
  const entries = await readDir(root);

  const results = await Promise.all(
    entries
      // Skip hidden directories (.claude, .Trash, .config…): never user
      // projects, and Tauri's fs scope glob won't match leading-dot segments.
      .filter((e) => e.isDirectory && !e.name.startsWith('.'))
      .map(async (entry): Promise<Repo | null> => {
        const subdirPath = await join(root, entry.name);
        const gitPath = await join(subdirPath, '.git');

        const isRepo = await exists(gitPath);
        if (!isRepo) return null;

        const [branch, dirty] = await Promise.all([
          getBranch(subdirPath),
          getDirty(subdirPath),
        ]);

        return {
          name: entry.name,
          path: subdirPath,
          branch,
          dirty,
          prCount: 0,
        };
      }),
  );

  return results.filter((r): r is Repo => r !== null);
}
