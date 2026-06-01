// repoDetail.ts — load README + a recursive file tree for the detail modal.
//
// README: first matching candidate file at the repo root, read as text.
// Tree:   recursive readDir of the whole repo (all files on disk, incl.
//         node_modules/dist/.env — per product choice). Guarded by a hard
//         entry cap + depth cap so a huge repo cannot freeze the UI; the cap
//         is surfaced to the user (truncated flag) rather than silently hidden.

import { readDir, readTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

/** A node in the repo file tree. Directories carry `children`. */
export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

export interface FileTreeResult {
  /** Top-level nodes (repo root contents). */
  root: TreeNode[];
  /** Total entries walked (files + dirs). */
  total: number;
  /** True if the cap stopped the walk before completion. */
  truncated: boolean;
}

export interface ReadmeResult {
  name: string;
  content: string;
}

const README_CANDIDATES = [
  'README.md',
  'Readme.md',
  'readme.md',
  'README.markdown',
  'README.MD',
  'README',
  'readme',
];

/** Hard limits — generous, but enough to stop node_modules from hanging the UI. */
const MAX_ENTRIES = 5000;
const MAX_DEPTH = 8;

/** Directories never worth walking — heavy, noisy, or VCS internals. */
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', '.cache']);

/**
 * Find and read the repo's README. Returns null when none of the candidate
 * filenames exist at the repo root.
 */
export async function getReadme(repoPath: string): Promise<ReadmeResult | null> {
  for (const candidate of README_CANDIDATES) {
    const full = await join(repoPath, candidate);
    try {
      if (await exists(full)) {
        const content = await readTextFile(full);
        return { name: candidate, content };
      }
    } catch {
      // Unreadable candidate — try the next one.
    }
  }
  return null;
}

/**
 * Build a recursive file tree for `repoPath`. Walks every file on disk
 * (unfiltered) up to MAX_ENTRIES / MAX_DEPTH, then marks the result truncated.
 * Directories are listed before files, each group sorted alphabetically.
 */
export async function getFileTree(repoPath: string): Promise<FileTreeResult> {
  const state = { count: 0, truncated: false };

  async function walk(dir: string, depth: number): Promise<TreeNode[]> {
    if (depth > MAX_DEPTH) {
      state.truncated = true;
      return [];
    }
    let entries;
    try {
      entries = await readDir(dir);
    } catch {
      return [];
    }

    // Directories first, then files; each alphabetical (case-insensitive).
    const sorted = [...entries].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    const nodes: TreeNode[] = [];
    for (const entry of sorted) {
      if (entry.isDirectory && IGNORED_DIRS.has(entry.name)) continue;
      if (state.count >= MAX_ENTRIES) {
        state.truncated = true;
        break;
      }
      state.count += 1;
      const childPath = await join(dir, entry.name);
      if (entry.isDirectory) {
        const children = await walk(childPath, depth + 1);
        nodes.push({ name: entry.name, path: childPath, isDir: true, children });
      } else {
        nodes.push({ name: entry.name, path: childPath, isDir: false });
      }
    }
    return nodes;
  }

  const root = await walk(repoPath, 0);
  return { root, total: state.count, truncated: state.truncated };
}

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
