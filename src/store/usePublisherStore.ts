// usePublisherStore — runtime-only Zustand store for the assisted-manual
// Publisher. Holds the CURRENT PublisherDraft and the actions that drive it.
//
// P0 invariants honoured here:
//   - Persists NOTHING. The whole store is ephemeral; only `publisherOutputDir`
//     + `publisherDefaultTarget` (in Settings, owned by useBoardStore) and the
//     resulting ActivityEvent slugs ever touch disk — and those are written by
//     the component layer, not here.
//   - AI text generation routes ONLY through the existing PTY claude path:
//     `generate()` builds a prompt and pushes it into the Code-tab terminal via
//     `useViewStore.requestAskCommand(cwd, prompt)`. No sidecar, no URLSession.
//   - Git stays read-only: reuses the existing `git_recent_commits`,
//     `git_local_stats`, `git_commits_since` invoke commands. No new git command.
//   - Asset render is LOCAL ONLY: `publisher_render_assets` spawns the local
//     Node renderer over stdio. A renderer-absent Err is tolerated (assets stay
//     empty + a soft note) and does NOT flip the draft into an error state.
//   - Publishing is assisted-manual: `openCompose()` only opens the platform
//     compose URL in the real browser via `publisher_open_compose`.
//
// DAG: this store imports types, the prompt util, the Tauri invoke/fs/path
// libs, and `useViewStore` only. It imports NO component. Settings (outDir) and
// activity logging are passed in / done by the component so this store never
// reaches up into useBoardStore.

import { create } from 'zustand';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { readTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type { PublisherDraft, PublisherTarget, PublisherAsset, Repo } from '../types';
import { buildPublisherPrompt } from '../utils/publisherPrompt';
import { useViewStore } from './useViewStore';

/** Soft note surfaced when the local renderer can't run. Mirrors the Rust side. */
const RENDERER_MISSING_HINT =
  'Renderer not installed — drafts work, image export is off. Run `npm install` in publisher-renderer/.';

/** Lookback window (days) used to summarise recent commit activity for the prompt. */
const ACTIVITY_WINDOW_DAYS = 14;

/** Cap the README excerpt fed into the prompt (matches aiContext budgeting). */
const README_EXCERPT_CHARS = 1200;

function freshDraft(target: PublisherTarget): PublisherDraft {
  return { repoName: '', target, body: '', assets: [], status: 'idle' };
}

/** Read-only: recent one-line commit subjects. Degrades to [] on any failure. */
async function gatherRecentCommits(path: string): Promise<string[]> {
  try {
    return await invoke<string[]>('git_recent_commits', { path, count: 20 });
  } catch {
    return [];
  }
}

/** Read-only: a plain-text activity summary for the prompt. '' on failure. */
async function gatherStats(path: string): Promise<string> {
  try {
    // git_local_stats -> (commitCount, lastCommitAt | null, branchCount)
    const [commitCount, lastCommitAt, branchCount] = await invoke<[number, string | null, number]>(
      'git_local_stats',
      { path },
    );
    const windowCount = await gatherWindowCommitCount(path);
    return [
      `Total commits on HEAD: ${commitCount}`,
      `Local branches: ${branchCount}`,
      lastCommitAt ? `Last commit: ${lastCommitAt}` : null,
      windowCount !== null
        ? `Commits in the last ${ACTIVITY_WINDOW_DAYS} days: ${windowCount}`
        : null,
    ]
      .filter((l): l is string => l !== null)
      .join('\n');
  } catch {
    return '';
  }
}

/** Read-only: count of commits in the lookback window, or null on failure. */
async function gatherWindowCommitCount(path: string): Promise<number | null> {
  try {
    const sinceIso = new Date(
      Date.now() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const since = await invoke<string[]>('git_commits_since', { path, sinceIso });
    return since.length;
  } catch {
    return null;
  }
}

/** Read-only: a capped README excerpt for grounding, or '' when absent. */
async function gatherReadmeExcerpt(path: string): Promise<string> {
  try {
    const readmePath = await join(path, 'README.md');
    if (await exists(readmePath)) {
      return (await readTextFile(readmePath)).slice(0, README_EXCERPT_CHARS);
    }
  } catch {
    // fall through to empty excerpt
  }
  return '';
}

interface PublisherStore {
  /** The single in-flight draft. Runtime-only — never persisted. */
  draft: PublisherDraft;
  /** Soft, non-fatal note (e.g. renderer not installed). null when clean. */
  note: string | null;

  /** Set the target platform (LinkedIn / Reddit). */
  setTarget: (target: PublisherTarget) => void;
  /** Set the draft's repo slug (display only; `generate` uses the full Repo). */
  setRepo: (repoName: string) => void;
  /** Replace the editable draft body (textarea two-way binding). */
  setBody: (body: string) => void;

  /**
   * Build a grounded prompt from read-only git context + README and push it into
   * the Code-tab PTY (the human's `claude` session writes the post). Then, when
   * an `outDir` is configured, render share assets LOCALLY — tolerating a
   * renderer-absent Err by leaving assets empty and setting a soft note.
   *
   * `outDir` is supplied by the component (Settings.publisherOutputDir) so this
   * store never imports useBoardStore. Signature adapted from generate(repo).
   */
  generate: (repo: Repo, outDir: string | null) => Promise<void>;

  /** Copy the current draft body to the clipboard for manual paste. */
  copyDraft: () => Promise<void>;
  /** Open the platform compose page in the real browser (assisted-manual). */
  openCompose: () => Promise<void>;

  /** Reset back to an idle draft, preserving the chosen target. */
  reset: () => void;
}

export const usePublisherStore = create<PublisherStore>((set, get) => ({
  draft: freshDraft('linkedin'),
  note: null,

  setTarget: (target) => {
    set((s) => ({ draft: { ...s.draft, target } }));
  },

  setRepo: (repoName) => {
    set((s) => ({ draft: { ...s.draft, repoName } }));
  },

  setBody: (body) => {
    set((s) => ({ draft: { ...s.draft, body } }));
  },

  generate: async (repo, outDir) => {
    set((s) => ({
      note: null,
      draft: { ...s.draft, repoName: repo.name, assets: [], status: 'generating' },
    }));

    // ── Read-only git + README context (each helper degrades gracefully) ──
    const [recentCommits, stats, readmeExcerpt] = await Promise.all([
      gatherRecentCommits(repo.path),
      gatherStats(repo.path),
      gatherReadmeExcerpt(repo.path),
    ]);

    const { target } = get().draft;

    // ── Push the prompt into the Code-tab PTY (the ONLY AI generation path) ──
    const prompt = buildPublisherPrompt({
      repoName: repo.name,
      target,
      recentCommits,
      stats,
      readmeExcerpt,
    });
    useViewStore.getState().requestAskCommand(repo.path, prompt);

    // ── Optionally render share assets LOCALLY ──
    if (!outDir) {
      set((s) => ({
        draft: { ...s.draft, status: 'ready' },
        note: 'Set a Publisher output directory in Settings to render share images.',
      }));
      return;
    }

    set((s) => ({ draft: { ...s.draft, status: 'rendering' } }));
    try {
      // A single repo-card carousel page is a valid offscreen CardSpec.
      const dataJson = JSON.stringify({ cards: [{ kind: 'repo-card', repo }] });
      const paths = await invoke<string[]>('publisher_render_assets', {
        repoName: repo.name,
        target,
        dataJson,
        outDir,
      });
      const assets: PublisherAsset[] = paths.map((absPath) => ({ kind: 'carousel', absPath }));
      set((s) => ({ draft: { ...s.draft, assets, status: 'ready' }, note: null }));
    } catch (err) {
      // Renderer-absent (or any render failure) is non-fatal: keep the draft
      // usable, surface a soft note, do NOT enter the error state.
      const msg = String(err);
      const note = msg.includes('renderer not installed')
        ? RENDERER_MISSING_HINT
        : `Image export unavailable: ${msg}`;
      set((s) => ({ draft: { ...s.draft, assets: [], status: 'ready' }, note }));
    }
  },

  copyDraft: async () => {
    const body = get().draft.body;
    await navigator.clipboard.writeText(body);
  },

  openCompose: async () => {
    const { target } = get().draft;
    await invoke('publisher_open_compose', { target });
  },

  reset: () => {
    set((s) => ({ draft: freshDraft(s.draft.target), note: null }));
  },
}));

/** Re-export for the component layer: turn an absolute asset path into a
 *  webview-loadable src (local file://-backed, no network). */
export function assetSrc(absPath: string): string {
  return convertFileSrc(absPath);
}
