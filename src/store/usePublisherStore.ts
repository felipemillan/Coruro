// usePublisherStore — runtime-only Zustand store for the assisted-manual
// Publisher (v4). Holds the CURRENT PublisherDraft and the actions that drive it.
//
// P0 invariants: no persistence, headless claude -p only, git read-only,
// no auto-post, no image gen. See module-level comment history in git.
//
// DAG: components -> stores -> utils -> types. No component or other store import.

import { create, type StoreApi } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { readTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type {
  PublisherDraft,
  PublisherTarget,
  PostFormat,
  PublisherIntent,
  PublisherModel,
  PublisherHistoryEntry,
  PublisherRole,
  PublisherSeniority,
  PublisherQuestion,
  Repo,
} from '../types';
import { buildPublisherPrompt } from '../utils/publisherPrompt';
import { defaultFormatFor, joinSegments, parsePublisherOutput } from '../utils/publisherFormats';
import {
  staticQuestionsFor,
  buildTailorQuestionsPrompt,
  parseTailoredQuestions,
} from '../utils/publisherQuestions';

const ACTIVITY_WINDOW_DAYS = 14;
const README_EXCERPT_CHARS = 1200;

interface BriefDefaults {
  roles?: PublisherRole[];
  seniority?: PublisherSeniority;
  audience?: string;
}

function freshDraft(
  target: PublisherTarget,
  format: PostFormat,
  defaults?: BriefDefaults,
): PublisherDraft {
  return {
    repoName: '',
    target,
    format,
    intent: 'story',
    guidance: '',
    model: 'claude-sonnet-4-6',
    count: 1,
    variations: [],
    selectedVariation: 0,
    status: 'idle',
    roles: defaults?.roles ?? ['vibe-coder'],
    seniority: defaults?.seniority ?? 'senior',
    audience: defaults?.audience ?? '',
    answers: {},
    tailoredQuestions: null,
    questionsStatus: 'idle',
  };
}

async function gatherRecentCommits(path: string): Promise<string[]> {
  try {
    return await invoke<string[]>('git_recent_commits', { path, count: 20 });
  } catch {
    return [];
  }
}

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

async function gatherStats(path: string): Promise<string> {
  try {
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

export interface GenerateOptions {
  authorVoice?: string;
}

interface PublisherStore {
  draft: PublisherDraft;
  note: string | null;

  setTarget: (target: PublisherTarget) => void;
  setFormat: (format: PostFormat) => void;
  setIntent: (intent: PublisherIntent) => void;
  setGuidance: (guidance: string) => void;
  setModel: (model: PublisherModel) => void;
  setCount: (count: number) => void;
  setRepo: (repoName: string) => void;
  selectVariation: (index: number) => void;
  setRoles: (roles: PublisherRole[]) => void;
  setSeniority: (seniority: PublisherSeniority) => void;
  setAudience: (audience: string) => void;
  setAnswer: (id: string, text: string) => void;
  clearAnswers: () => void;
  tailorQuestions: (repo: Repo, opts?: GenerateOptions) => Promise<void>;
  generate: (repo: Repo, opts?: GenerateOptions) => Promise<void>;
  copyVariation: () => Promise<void>;
  copySegment: (index: number) => Promise<void>;
  openCompose: () => Promise<void>;
  loadFromHistory: (entry: PublisherHistoryEntry, mode?: 'view' | 'repurpose') => void;
  reset: () => void;
}

// Narrow type aliases matching the plain-store (no middleware) set/get signature.
type StoreSet = StoreApi<PublisherStore>['setState'];
type StoreGet = StoreApi<PublisherStore>['getState'];

// ── Module-level action implementations ─────────────────────────────────────

function resolveBriefFields(
  brief: PublisherHistoryEntry['brief'],
  current: PublisherDraft,
  isRepurpose: boolean,
) {
  return {
    roles: brief.roles.length > 0 ? brief.roles : current.roles,
    seniority: brief.seniority,
    audience: brief.audience.length > 0 ? brief.audience : current.audience,
    // Guidance is saved context meant to be reused — restore it in BOTH modes.
    guidance: brief.guidance,
    answers: isRepurpose ? {} : brief.answers,
  };
}

function buildHistoryDraft(
  current: PublisherDraft,
  entry: PublisherHistoryEntry,
  mode: 'view' | 'repurpose',
): PublisherDraft {
  const isRepurpose = mode === 'repurpose';
  const briefFields = resolveBriefFields(entry.brief, current, isRepurpose);
  const variations = isRepurpose ? [] : entry.variations;
  const count = isRepurpose
    ? current.count
    : (Math.min(5, Math.max(1, entry.variations.length || 1)) as PublisherDraft['count']);
  return {
    ...current,
    repoName: entry.repoName,
    target: entry.target,
    format: entry.format,
    intent: entry.intent,
    model: entry.model,
    ...briefFields,
    tailoredQuestions: null,
    questionsStatus: 'idle',
    variations,
    count,
    selectedVariation: 0,
    status: isRepurpose ? 'idle' : 'ready',
  };
}

async function runTailorQuestions(
  set: StoreSet,
  get: StoreGet,
  repo: Repo,
  opts?: GenerateOptions,
): Promise<void> {
  const { intent, roles, seniority, audience, model } = get().draft;
  set((s) => ({ draft: { ...s.draft, questionsStatus: 'tailoring' } }));
  const recentCommits = await gatherRecentCommits(repo.path);
  const prompt = buildTailorQuestionsPrompt({
    intent,
    roles,
    seniority,
    audience,
    repoName: repo.name,
    authorVoice: opts?.authorVoice ?? '',
    recentCommits,
  });
  try {
    const raw = await invoke<string>('publisher_generate', { prompt, model });
    const qs = parseTailoredQuestions(raw);
    const tailoredQuestions = qs.length > 0 ? qs : null;
    const questionsStatus = qs.length > 0 ? ('idle' as const) : ('error' as const);
    set((s) => ({ draft: { ...s.draft, tailoredQuestions, questionsStatus } }));
  } catch {
    set((s) => ({ draft: { ...s.draft, questionsStatus: 'error' } }));
  }
}

async function runGenerate(
  set: StoreSet,
  get: StoreGet,
  repo: Repo,
  opts?: GenerateOptions,
): Promise<void> {
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

  const [recentCommits, stats, readmeExcerpt] = await Promise.all([
    gatherRecentCommits(repo.path),
    gatherStats(repo.path),
    gatherReadmeExcerpt(repo.path),
  ]);

  const {
    target,
    format,
    intent,
    guidance,
    model,
    count,
    roles,
    seniority,
    audience,
    answers,
    tailoredQuestions,
  } = get().draft;
  const authorVoice = opts?.authorVoice ?? '';
  const questions: PublisherQuestion[] = tailoredQuestions ?? staticQuestionsFor(intent, roles);

  const prompt = buildPublisherPrompt({
    repoName: repo.name,
    target,
    format,
    intent,
    guidance,
    count,
    authorVoice,
    recentCommits,
    stats,
    readmeExcerpt,
    roles,
    seniority,
    audience,
    answers,
    questions,
  });
  try {
    const raw = await invoke<string>('publisher_generate', { prompt, model });
    const variations = parsePublisherOutput(raw);
    set((s) => ({
      draft: { ...s.draft, variations, selectedVariation: 0, status: 'ready' },
      note: null,
    }));
  } catch (err) {
    set((s) => ({ draft: { ...s.draft, status: 'error' }, note: String(err) }));
  }
}

// ── Store ────────────────────────────────────────────────────────────────────

export const usePublisherStore = create<PublisherStore>((set, get) => ({
  draft: freshDraft('linkedin', defaultFormatFor('linkedin')),
  note: null,

  setTarget: (target) => {
    set((s) => ({
      draft: { ...s.draft, target, format: defaultFormatFor(target), selectedVariation: 0 },
    }));
  },

  setFormat: (format) => {
    set((s) => ({ draft: { ...s.draft, format } }));
  },
  setIntent: (intent) => {
    set((s) => ({ draft: { ...s.draft, intent } }));
  },
  setGuidance: (guidance) => {
    set((s) => ({ draft: { ...s.draft, guidance } }));
  },
  setModel: (model) => {
    set((s) => ({ draft: { ...s.draft, model } }));
  },
  setRepo: (repoName) => {
    set((s) => ({ draft: { ...s.draft, repoName } }));
  },

  setCount: (count) => {
    const clamped = Math.min(5, Math.max(1, Math.floor(count))) as PublisherDraft['count'];
    set((s) => ({ draft: { ...s.draft, count: clamped } }));
  },

  selectVariation: (index) => {
    set((s) => {
      const max = Math.max(0, s.draft.variations.length - 1);
      const clamped = Math.min(max, Math.max(0, Math.floor(index)));
      return { draft: { ...s.draft, selectedVariation: clamped } };
    });
  },

  setRoles: (roles) => {
    set((s) => ({ draft: { ...s.draft, roles } }));
  },
  setSeniority: (seniority) => {
    set((s) => ({ draft: { ...s.draft, seniority } }));
  },
  setAudience: (audience) => {
    set((s) => ({ draft: { ...s.draft, audience } }));
  },

  setAnswer: (id, text) => {
    set((s) => ({ draft: { ...s.draft, answers: { ...s.draft.answers, [id]: text } } }));
  },

  clearAnswers: () => {
    set((s) => ({ draft: { ...s.draft, answers: {} } }));
  },

  tailorQuestions: (repo, opts) => runTailorQuestions(set, get, repo, opts),
  generate: (repo, opts) => runGenerate(set, get, repo, opts),

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

  loadFromHistory: (entry, mode = 'view') => {
    set((s) => ({ note: null, draft: buildHistoryDraft(s.draft, entry, mode) }));
  },

  reset: () => {
    set((s) => ({
      draft: freshDraft(s.draft.target, s.draft.format, {
        roles: s.draft.roles,
        seniority: s.draft.seniority,
        audience: s.draft.audience,
      }),
      note: null,
    }));
  },
}));
