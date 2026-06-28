// usePublisherStore — runtime-only Zustand store for the assisted-manual
// Publisher (v2). Holds the CURRENT PublisherDraft and the actions that drive it.
//
// P0 invariants honoured here:
//   - Persists NOTHING. The whole store is ephemeral: the draft, its variations,
//     and its segments are runtime-only and never touch disk. The only Publisher
//     state that persists (publisherAuthorVoice / publisherDefaultTarget /
//     publisherDefaultFormat) lives in Settings, owned by useBoardStore, and is
//     passed IN via `generate(..., opts)` so this store never reaches up into a
//     component or another store.
//   - AI text generation routes through a HEADLESS `claude -p` call (the same
//     plan-billed claude path the PTY uses, NOT the FoundationModels sidecar):
//     `generate()` builds a content-only prompt and invokes `publisher_generate`,
//     which spawns claude in a neutral temp dir with mutation tools disabled. The
//     model returns text only — it cannot touch a repo. No sidecar, no URLSession.
//   - Git stays read-only: reuses the existing `git_recent_commits`,
//     `git_local_stats`, `git_commits_since` invoke commands. No new git command.
//   - No image generation, no local renderer, no filesystem output dir. The whole
//     asset-render path is gone in v2 — Publisher emits copy-ready text only.
//   - Publishing is assisted-manual: `openCompose()` only opens the platform
//     compose URL in the real browser via `publisher_open_compose`, and copy
//     actions place text on the clipboard for manual paste.
//
// DAG (components -> stores -> utils -> types): this store imports types, the two
// publisher utils, and the Tauri invoke/fs/path libs only. It imports NO
// component and NO other store.

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { readTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type { PublisherDraft, PublisherTarget, PostFormat, Repo } from '../types';
import { buildPublisherPrompt } from '../utils/publisherPrompt';
import { defaultFormatFor, joinSegments, parsePublisherOutput } from '../utils/publisherFormats';

/** Lookback window (days) used to summarise recent commit activity for the prompt. */
const ACTIVITY_WINDOW_DAYS = 14;

/** Cap the README excerpt fed into the prompt (matches aiContext budgeting). */
const README_EXCERPT_CHARS = 1200;

function freshDraft(target: PublisherTarget, format: PostFormat): PublisherDraft {
  return {
    repoName: '',
    target,
    format,
    count: 1,
    variations: [],
    selectedVariation: 0,
    status: 'idle',
  };
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

/** Optional inputs the component supplies from persisted Settings. */
export interface GenerateOptions {
  /** Settings.publisherAuthorVoice — the author identity/voice. Defaults to ''. */
  authorVoice?: string;
}

interface PublisherStore {
  /** The single in-flight draft. Runtime-only — never persisted. */
  draft: PublisherDraft;
  /** Soft, non-fatal note surfaced on error. null when clean. */
  note: string | null;

  /**
   * Set the target platform. Resets `format` to the recommended default for the
   * new target and clamps `selectedVariation` back to 0.
   */
  setTarget: (target: PublisherTarget) => void;
  /** Set the post format (caller is responsible for validity vs. the target). */
  setFormat: (format: PostFormat) => void;
  /** Set the requested variation count, clamped to 1–5. */
  setCount: (count: number) => void;
  /** Set the draft's repo slug (display only; `generate` uses the full Repo). */
  setRepo: (repoName: string) => void;
  /** Select the active variation by index, clamped to the available range. */
  selectVariation: (index: number) => void;

  /**
   * Build a grounded, content-only prompt from read-only git context + README and
   * generate N voice-driven variations HEADLESS via the `publisher_generate`
   * Tauri command (claude -p in a neutral temp dir). The parsed variations fill
   * the draft in-app. target/format/count come from the current draft;
   * `opts.authorVoice` is supplied by the component from persisted Settings so
   * this store never imports useBoardStore. On any Err (including CLAUDE_MISSING)
   * the draft flips to 'error' with a soft note — it never crashes the tab.
   */
  generate: (repo: Repo, opts?: GenerateOptions) => Promise<void>;

  /** Copy the selected variation (joined per format) to the clipboard. */
  copyVariation: () => Promise<void>;
  /** Copy a single segment of the selected variation to the clipboard. */
  copySegment: (index: number) => Promise<void>;
  /** Open the platform compose page in the real browser (assisted-manual). */
  openCompose: () => Promise<void>;

  /** Reset back to an idle draft, preserving the chosen target + format. */
  reset: () => void;
}

export const usePublisherStore = create<PublisherStore>((set, get) => ({
  draft: freshDraft('linkedin', defaultFormatFor('linkedin')),
  note: null,

  setTarget: (target) => {
    set((s) => ({
      draft: {
        ...s.draft,
        target,
        format: defaultFormatFor(target),
        selectedVariation: 0,
      },
    }));
  },

  setFormat: (format) => {
    set((s) => ({ draft: { ...s.draft, format } }));
  },

  setCount: (count) => {
    const clamped = Math.min(5, Math.max(1, Math.floor(count))) as PublisherDraft['count'];
    set((s) => ({ draft: { ...s.draft, count: clamped } }));
  },

  setRepo: (repoName) => {
    set((s) => ({ draft: { ...s.draft, repoName } }));
  },

  selectVariation: (index) => {
    set((s) => {
      const max = Math.max(0, s.draft.variations.length - 1);
      const clamped = Math.min(max, Math.max(0, Math.floor(index)));
      return { draft: { ...s.draft, selectedVariation: clamped } };
    });
  },

  generate: async (repo, opts) => {
    set((s) => ({
      note: null,
      draft: {
        ...s.draft,
        repoName: repo.name,
        variations: [],
        selectedVariation: 0,
        status: 'generating',
      },
    }));

    // ── Read-only git + README context (each helper degrades gracefully) ──
    const [recentCommits, stats, readmeExcerpt] = await Promise.all([
      gatherRecentCommits(repo.path),
      gatherStats(repo.path),
      gatherReadmeExcerpt(repo.path),
    ]);

    const { target, format, count } = get().draft;
    const authorVoice = opts?.authorVoice ?? '';

    // ── Generate the variations HEADLESS via claude -p (content-only) ──
    const prompt = buildPublisherPrompt({
      repoName: repo.name,
      target,
      format,
      count,
      authorVoice,
      recentCommits,
      stats,
      readmeExcerpt,
    });
    try {
      const raw = await invoke<string>('publisher_generate', { prompt });
      const variations = parsePublisherOutput(raw);
      set((s) => ({
        draft: { ...s.draft, variations, selectedVariation: 0, status: 'ready' },
        note: null,
      }));
    } catch (err) {
      // claude missing or any generation failure: surface a soft note and flip
      // to the error state. Do not crash the tab.
      set((s) => ({ draft: { ...s.draft, status: 'error' }, note: String(err) }));
    }
  },

  copyVariation: async () => {
    const { variations, selectedVariation, format } = get().draft;
    const variation = variations[selectedVariation];
    if (!variation) return;
    await navigator.clipboard.writeText(joinSegments(variation, format));
  },

  copySegment: async (index) => {
    const { variations, selectedVariation } = get().draft;
    const segment = variations[selectedVariation]?.segments[index];
    if (!segment) return;
    await navigator.clipboard.writeText(segment.text);
  },

  openCompose: async () => {
    const { target } = get().draft;
    await invoke('publisher_open_compose', { target });
  },

  reset: () => {
    set((s) => ({ draft: freshDraft(s.draft.target, s.draft.format), note: null }));
  },
}));
