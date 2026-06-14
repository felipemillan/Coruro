// Zustand store for Coruro.
//
// Holds the persisted AppState (settings/board/repoMetadata) plus runtime-only
// fields: the scanned `repos` list and a `loaded` flag.
//
// Persistence rules (PRD + plan):
//  - State file: ~/.repo_dashboard_state.json via @tauri-apps/plugin-fs,
//    BaseDirectory.Home.
//  - LOAD BEFORE SAVE: never write to disk until load() has completed. This
//    prevents a startup race where an early save clobbers an existing file
//    with default state before it has been read.
//  - The raw GitHub token NEVER touches JSON. It lives in the macOS Keychain
//    via the Rust `store_token` / `get_token` commands. Only the boolean
//    `hasToken` flag is persisted.
//  - updateNotes() debounces disk writes by 500ms so typing doesn't thrash IO.

import { create } from 'zustand';
import { readTextFile, writeTextFile, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import {
  type AppState,
  type Board,
  type ColumnId,
  type Repo,
  type RepoGitHub,
  type AiCacheEntry,
  type AiResult,
  type DayNote,
  type ChatSession,
  COLUMN_IDS,
  createEmptyAppState,
} from '../types';
import { scanRepos } from '../utils/scanner';
import { parseRemote, fetchRepoCard } from '../utils/github';
import { readRepoNotes, writeRepoNotes } from '../utils/notesFile';
import { buildAiContext, inputHash, capItemsToContextBudget } from '../utils/aiContext';
import { formatRepoContext, capContextLines } from '../utils/dayNotesContext';
import {
  parseDirtyStat,
  composeSessionReport,
  qualitativeDigest,
  type RepoActivity,
} from '../utils/sessionReport';
import type { EnrichedRepoEntry, CommitDetail } from '../utils/dayNotesContext';
import { fetchUserLogin } from '../utils/githubUser';
import { fetchUserEvents } from '../utils/githubEvents';
import { fetchCIOutcomes, formatCILine } from '../utils/githubCI';
import { fetchPRDetails, formatPRLine } from '../utils/githubPRDetails';
import {
  validateSettings,
  validateBoard,
  validateRepoMetadata,
  validateGhCache,
  validateAiCache,
  validateDayNotes,
  validateChatSessions,
} from '../utils/appStateValidation';

/** Filename written under the user's home directory. */
const STATE_FILE = '.repo_dashboard_state.json';

/** Extract a human-readable message from an unknown thrown value. */
const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Sentinel thrown inside fetchWithTimeout when the GitHub API returns 429. */
class RateLimitError extends Error {
  constructor() {
    super('GitHub API rate limit exceeded');
    this.name = 'RateLimitError';
  }
}

/** Debounce window (ms) for persisting note edits. */
const NOTES_DEBOUNCE_MS = 500;

interface BoardStore extends AppState {
  /** Runtime-only: repos discovered by the most recent filesystem scan. */
  repos: Repo[];
  /** True once load() has finished. Save is a no-op until this is true. */
  loaded: boolean;
  /** Runtime-only: message from the most recent failed scan, else null. */
  lastScanError: string | null;
  /** Runtime-only: repo paths currently being analysed by the AI sidecar. */
  analyzingPaths: Set<string>;
  /** Runtime-only: reason Apple Intelligence is unavailable this session, else null. */
  aiUnavailableReason: string | null;
  /** Runtime-only: true while the AI sidecar is generating a day note. NOT persisted. */
  generatingNotes: boolean;
  /** Runtime-only: last notes-generation error message; null when clean. NOT persisted. */
  notesError: string | null;

  /** Read state from disk (or initialise defaults if the file is missing). */
  load: () => Promise<void>;
  /** Persist the current AppState slice to disk. No-op before load completes. */
  save: () => Promise<void>;

  /** Set the scanned root directory, persist, and let the caller trigger a scan. */
  setRootDirectory: (path: string) => Promise<void>;
  /** Move a repo card between/within columns, reordering, then persist. */
  moveCard: (repoPath: string, from: ColumnId, to: ColumnId, index: number) => void;
  /** Update a repo's notes; persists after a 500ms debounce. */
  updateNotes: (repoPath: string, notes: string) => void;
  /** Replace the runtime repo list (from a scan). Not persisted. */
  setRepos: (repos: Repo[]) => void;
  /**
   * Scan `root` for repos, replace the runtime repo list, file any
   * not-yet-placed repo path into board.inbox, then persist. Shared by
   * App/Setup/Settings so first-run, restart, and root-change all converge.
   */
  scanAndDistribute: (root: string) => Promise<void>;

  /**
   * Enrich the current runtime repos with GitHub data (badges/overview).
   * Runtime-only; never persisted. Safe to fire-and-forget after a scan.
   */
  enrichGitHub: () => Promise<void>;

  /** Refresh GitHub data for a single repo (per-card refresh button). */
  enrichOne: (path: string) => Promise<void>;

  /** Compute ahead/behind-upstream for all repos (local git; runtime-only). */
  enrichGit: () => Promise<void>;

  /** Recompute ahead/behind for one repo (after a fetch). Runtime-only. */
  enrichGitOne: (path: string) => Promise<void>;

  /**
   * Serially analyse the current runtime repos with the on-device AI sidecar,
   * skipping repos whose cached inputHash is still fresh. Persists results and
   * stops the queue if Apple Intelligence reports unavailable.
   */
  enrichAi: () => Promise<void>;

  /** Force a (re)analysis of a single repo (per-card AI button). */
  enrichAiOne: (path: string) => Promise<void>;

  /** Set the auto-refresh interval (minutes; 0 = off) and persist. */
  setRefreshInterval: (min: number) => Promise<void>;

  /** Toggle the top-bar debug banner on/off and persist the choice. */
  setDebugBannerEnabled: (enabled: boolean) => Promise<void>;
  /** Set the editor CLI command (tried first) and persist. */
  setEditorCommand: (command: string) => Promise<void>;
  /** Set the macOS editor app name (open -a fallback) and persist. */
  setEditorApp: (app: string) => Promise<void>;
  /** Set the macOS terminal app name (open -a) and persist. */
  setTerminalApp: (app: string) => Promise<void>;

  /** Append a DayNote; trims the list to 90 entries and persists. */
  addDayNote: (note: DayNote) => void;
  /** Clear all day notes and persist. */
  clearDayNotes: () => void;
  /** Delete a single day-note by id and persist. */
  deleteDayNote: (id: string) => void;
  /** Append a human-written DayNote (trigger 'user') built from the given body. */
  addUserNote: (body: string) => void;

  /** Append an ASK chat session (metadata only) and persist. */
  addChatSession: (session: ChatSession) => void;
  /** Update one session's status + exitCode (e.g. on PTY exit) and persist. */
  updateChatSessionStatus: (
    id: string,
    status: ChatSession['status'],
    exitCode: number | null,
  ) => void;
  /** Hard-delete one chat session by id and persist. */
  deleteChatSession: (id: string) => void;
  /** Replace a day-note's body, stamp editedAt, recompute repoRefs, persist. */
  updateDayNote: (id: string, body: string) => void;
  /** Toggle auto-note generation on/off and persist. */
  setAutoNotesEnabled: (enabled: boolean) => void;
  /** Set the auto-note interval (minutes) and persist. */
  setAutoNotesIntervalMin: (min: number) => void;

  /** Generate a day-note by querying the AI sidecar over the recent commit window. */
  generateDayNotes: (trigger: 'manual' | 'auto') => Promise<void>;
  /** Start (or restart) the auto-notes interval timer based on current settings.
   *  Pass `skipImmediateFire: true` when changing settings at runtime so the
   *  timer resets without triggering an unwanted immediate generation. */
  setupAutoNotesTimer: (opts?: { skipImmediateFire?: boolean }) => void;
  /** Clear a displayed notes error (dismiss button). */
  clearNotesError: () => void;

  /** Store a PAT in the Keychain and flip hasToken; persists the flag. */
  storeToken: (token: string) => Promise<void>;
  /** Refresh hasToken from the Keychain (does not expose the raw token). */
  refreshHasToken: () => Promise<void>;
}

/** Module-level ref for the auto-notes setInterval handle. */
let autoNotesTimerRef: ReturnType<typeof setInterval> | null = null;

/**
 * Extract repo name refs from a day-note body (tokens prefixed with @).
 * Returns a deduplicated array of the name strings (without the @).
 */
function extractRepoRefs(body: string): string[] {
  const matches = body.match(/@([a-zA-Z0-9_-]+)/g) || [];
  return [...new Set(matches.map((m: string) => m.slice(1)))];
}

/** Serialise only the persisted AppState slice (never runtime fields/token). */
function serialise(state: AppState): string {
  const snapshot: AppState = {
    settings: state.settings,
    board: state.board,
    repoMetadata: state.repoMetadata,
    ghCache: state.ghCache,
    aiCache: state.aiCache,
    dayNotes: state.dayNotes,
    chatSessions: state.chatSessions,
  };
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Per-repo debounce timers for notes saves. Keyed by repo path so editing
 * notes on one card never cancels a pending write for another.
 */
const notesSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Serialises every disk write through a single promise chain so concurrent
 * callers (debounced updateNotes + moveCard, etc.) can never interleave
 * partial writes and corrupt the state JSON. Each save() appends to the chain
 * and resolves only after its own write completes.
 */
let writeChain: Promise<void> = Promise.resolve();

/**
 * Runtime validator: coerce a parsed-from-disk value into a sound AppState.
 * A corrupt or hand-edited file (e.g. board.inbox not an array) must never
 * crash downstream .map/.indexOf — wrong-typed/missing fields fall back to
 * the empty defaults.
 */
function validateAppState(raw: unknown): AppState {
  const base = createEmptyAppState();
  if (typeof raw !== 'object' || raw === null) return base;
  const parsed = raw as Record<string, unknown>;

  // Each slice is validated by a pure, independently-tested validator
  // (src/utils/appStateValidation.ts). A malformed slice degrades to its
  // default rather than crashing hydration.
  return {
    settings: validateSettings(parsed.settings, base.settings),
    board: validateBoard(parsed.board, base.board),
    repoMetadata: validateRepoMetadata(parsed.repoMetadata, base.repoMetadata),
    ghCache: validateGhCache(parsed.ghCache, base.ghCache),
    aiCache: validateAiCache(parsed.aiCache, base.aiCache),
    dayNotes: validateDayNotes(parsed.dayNotes, base.dayNotes),
    chatSessions: validateChatSessions(parsed.chatSessions, base.chatSessions),
  };
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  ...createEmptyAppState(),
  repos: [],
  loaded: false,
  lastScanError: null,
  analyzingPaths: new Set(),
  aiUnavailableReason: null,
  generatingNotes: false,
  notesError: null,

  load: async () => {
    try {
      const present = await exists(STATE_FILE, { baseDir: BaseDirectory.Home });
      if (present) {
        const raw = await readTextFile(STATE_FILE, {
          baseDir: BaseDirectory.Home,
        });
        // Validate at runtime: a corrupt / hand-edited file (e.g. a column
        // that isn't an array) is coerced back to sound defaults rather than
        // crashing downstream .map/.indexOf.
        const state = validateAppState(JSON.parse(raw) as unknown);
        set({
          settings: state.settings,
          board: state.board,
          repoMetadata: state.repoMetadata,
          ghCache: state.ghCache,
          aiCache: state.aiCache,
          dayNotes: state.dayNotes,
          chatSessions: state.chatSessions,
          loaded: true,
        });
      } else {
        set({ ...createEmptyAppState(), loaded: true });
      }
    } catch {
      // Corrupt or unreadable file: fall back to clean defaults rather than
      // leaving the app in an unloaded (unsaveable) state.
      set({ ...createEmptyAppState(), loaded: true });
    }
    // Reflect Keychain token presence into the persisted hasToken flag.
    await get().refreshHasToken();
  },

  save: async () => {
    // Load-before-save guard: refuse to write until initial load has run.
    // Checked up-front so a no-op save doesn't extend the write chain.
    if (!get().loaded) return Promise.resolve();
    // Serialise the snapshot now (synchronously), but commit the disk write
    // through writeChain so concurrent saves never interleave partial writes.
    const { settings, board, repoMetadata, ghCache, aiCache, dayNotes, chatSessions } = get();
    const payload = serialise({
      settings,
      board,
      repoMetadata,
      ghCache,
      aiCache,
      dayNotes,
      chatSessions,
    });
    writeChain = writeChain.then(() =>
      writeTextFile(STATE_FILE, payload, { baseDir: BaseDirectory.Home }),
    );
    return writeChain;
  },

  setRootDirectory: async (path) => {
    set((s) => ({ settings: { ...s.settings, rootDirectory: path } }));
    await get().save();
    // Caller triggers the scan (keeps this store free of scanner dependency).
  },

  moveCard: (repoPath, from, to, index) => {
    set((s) => {
      const board: Board = {
        inbox: [...s.board.inbox],
        backlog: [...s.board.backlog],
        active: [...s.board.active],
        review: [...s.board.review],
        done: [...s.board.done],
      };
      // Remove from the source column wherever it currently sits.
      const srcIdx = board[from].indexOf(repoPath);
      if (srcIdx !== -1) board[from].splice(srcIdx, 1);
      // Guard against stale indices: clamp into the destination's bounds.
      const dest = board[to];
      const clamped = Math.max(0, Math.min(index, dest.length));
      dest.splice(clamped, 0, repoPath);
      return { board };
    });
    void get().save();
  },

  updateNotes: (repoPath, notes) => {
    set((s) => ({
      repoMetadata: {
        ...s.repoMetadata,
        [repoPath]: { ...s.repoMetadata[repoPath], notes },
      },
    }));
    // Persist to the in-repo coruro_notes.md (source of truth), debounced
    // per repo. The repo file — not central state — owns notes; the next scan
    // rehydrates from it, so notes travel with the repo via git.
    const existing = notesSaveTimers.get(repoPath);
    if (existing !== undefined) clearTimeout(existing);
    notesSaveTimers.set(
      repoPath,
      setTimeout(() => {
        notesSaveTimers.delete(repoPath);
        void writeRepoNotes(repoPath, notes).catch((e: unknown) => {
          set({
            lastScanError: `Failed to write coruro_notes.md: ${e instanceof Error ? e.message : String(e)}`,
          });
        });
      }, NOTES_DEBOUNCE_MS),
    );
  },

  setRepos: (repos) => {
    set({ repos });
  },

  scanAndDistribute: async (root) => {
    let repos: Repo[];
    try {
      repos = await scanRepos(root);
    } catch (e: unknown) {
      // Surface the failure to the UI (banner + Settings debug panel) instead
      // of throwing into an unhandled rejection that silently yields no repos.
      set({ lastScanError: e instanceof Error ? e.message : String(e) });
      return;
    }
    set({ lastScanError: null });

    // Hydrate gh from the persisted cache so badges render instantly, before
    // the background refresh resolves. Also prune cache entries for repos that
    // no longer exist, so the file can't grow without bound.
    const cache = get().ghCache;
    const aiCache = get().aiCache;
    const hydrated = repos.map((r) => {
      const ai = aiCache[r.path];
      return {
        ...r,
        gh: cache[r.path]?.gh ?? null,
        aiSummary: ai?.summary ?? null,
        aiTags: ai?.tags ?? null,
      };
    });
    get().setRepos(hydrated);
    set(() => {
      const valid = new Set(repos.map((r) => r.path));
      const pruned: typeof cache = {};
      for (const [path, entry] of Object.entries(cache)) {
        if (valid.has(path)) pruned[path] = entry;
      }
      return { ghCache: pruned };
    });

    // Hydrate notes from each repo's coruro_notes.md — the repo file is
    // authoritative and overrides the central cache. Repos without the file
    // keep any existing (central) value rather than being wiped to empty.
    const notesEntries = await Promise.all(
      repos.map(async (r) => [r.path, await readRepoNotes(r.path)] as const),
    );
    set((s) => {
      const repoMetadata = { ...s.repoMetadata };
      for (const [path, notes] of notesEntries) {
        if (notes !== null) repoMetadata[path] = { notes };
      }
      return { repoMetadata };
    });

    set((s) => {
      // Paths already placed in any column keep their position; only genuinely
      // new repos are filed into inbox. Rebuild board immutably.
      const placed = new Set<string>();
      for (const col of COLUMN_IDS) {
        for (const p of s.board[col]) placed.add(p);
      }
      const inbox = [...s.board.inbox];
      for (const repo of repos) {
        if (!placed.has(repo.path)) {
          inbox.push(repo.path);
          placed.add(repo.path);
        }
      }
      const board: Board = {
        inbox,
        backlog: [...s.board.backlog],
        active: [...s.board.active],
        review: [...s.board.review],
        done: [...s.board.done],
      };
      return { board };
    });
    await get().save();
    // Fire-and-forget enrichment: the board renders now; badges fill in when
    // each resolves. GitHub data over the network; ahead/behind from local git.
    void get().enrichGitHub();
    void get().enrichGit();
    void get().enrichAi();
  },

  enrichGitHub: async () => {
    const targets = get().repos.filter(
      (r) => typeof r.remoteUrl === 'string' && parseRemote(r.remoteUrl) !== null,
    );
    if (targets.length === 0) return;

    // Transient token (never stored in JS state); unauthenticated if absent.
    const token = await invoke<string | null>('get_token').catch((e: unknown) => {
      // Rust returns Ok(None) (→ null) when no token is stored; a rejection here
      // is a genuine Keychain access failure, not "no token". Surface it.
      console.error('[keychain] get_token failed', errorMessage(e));
      return null;
    });

    // Bounded-concurrency pool so a large root can't fire hundreds of requests.
    const CONCURRENCY = 6;
    const ghByPath = new Map<string, RepoGitHub>();
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < targets.length) {
        const repo = targets[cursor];
        cursor += 1;
        const coords = parseRemote(repo.remoteUrl as string);
        if (coords === null) continue;
        try {
          ghByPath.set(repo.path, await fetchRepoCard(coords, token ?? undefined));
        } catch {
          // Per-repo failure: leave gh null for this repo.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()),
    );

    // Merge by path against the LATEST repo list (a newer scan may have run).
    // A repo that failed this round keeps its previous gh (don't blank badges
    // on a transient error). Successful fetches update the persisted cache.
    const fetchedAt = new Date().toISOString();
    set((s) => {
      const ghCache = { ...s.ghCache };
      for (const [path, gh] of ghByPath) ghCache[path] = { gh, fetchedAt };
      return {
        repos: s.repos.map((r) => ({ ...r, gh: ghByPath.get(r.path) ?? r.gh ?? null })),
        ghCache,
      };
    });
    void get().save();
  },

  enrichOne: async (path) => {
    const repo = get().repos.find((r) => r.path === path);
    if (repo === undefined || typeof repo.remoteUrl !== 'string') return;
    const coords = parseRemote(repo.remoteUrl);
    if (coords === null) return;

    const token = await invoke<string | null>('get_token').catch((e: unknown) => {
      // Rust returns Ok(None) (→ null) when no token is stored; a rejection here
      // is a genuine Keychain access failure, not "no token". Surface it.
      console.error('[keychain] get_token failed', errorMessage(e));
      return null;
    });
    let gh: RepoGitHub;
    try {
      gh = await fetchRepoCard(coords, token ?? undefined);
    } catch {
      // Transient failure: keep the existing gh, don't blank the card.
      return;
    }

    const fetchedAt = new Date().toISOString();
    set((s) => ({
      repos: s.repos.map((r) => (r.path === path ? { ...r, gh } : r)),
      ghCache: { ...s.ghCache, [path]: { gh, fetchedAt } },
    }));
    void get().save();
  },

  setRefreshInterval: async (min) => {
    set((s) => ({ settings: { ...s.settings, refreshIntervalMin: min } }));
    await get().save();
  },

  enrichGit: async () => {
    const targets = get().repos;
    if (targets.length === 0) return;
    const CONCURRENCY = 8;
    const byPath = new Map<
      string,
      {
        ahead: number | null;
        behind: number | null;
        commitCount: number;
        lastCommitAt: string | null;
        branchCount: number;
      }
    >();
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < targets.length) {
        const repo = targets[cursor];
        cursor += 1;
        try {
          // git_ahead_behind returns [ahead, behind] or null (no upstream).
          const ab = await invoke<[number, number] | null>('git_ahead_behind', {
            path: repo.path,
          });
          // git_local_stats returns [commitCount, lastCommitAt, branchCount].
          const ls = await invoke<[number, string | null, number]>('git_local_stats', {
            path: repo.path,
          });
          byPath.set(repo.path, {
            ahead: ab === null ? null : ab[0],
            behind: ab === null ? null : ab[1],
            commitCount: ls[0],
            lastCommitAt: ls[1],
            branchCount: ls[2],
          });
        } catch {
          byPath.set(repo.path, {
            ahead: null,
            behind: null,
            commitCount: 0,
            lastCommitAt: null,
            branchCount: 0,
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()),
    );
    // Merge against the latest repo list (a newer scan may have run).
    set((s) => ({
      repos: s.repos.map((r) => {
        const v = byPath.get(r.path);
        if (!v) return r;
        return {
          ...r,
          ahead: v.ahead,
          behind: v.behind,
          commitCount: v.commitCount,
          lastCommitAt: v.lastCommitAt,
          branchCount: v.branchCount,
        };
      }),
    }));
  },

  enrichGitOne: async (path) => {
    let ab: [number, number] | null = null;
    let ls: [number, string | null, number] = [0, null, 0];
    try {
      ab = await invoke<[number, number] | null>('git_ahead_behind', { path });
      ls = await invoke<[number, string | null, number]>('git_local_stats', { path });
    } catch {
      return;
    }
    set((s) => ({
      repos: s.repos.map((r) =>
        r.path === path
          ? {
              ...r,
              ahead: ab?.[0] ?? null,
              behind: ab?.[1] ?? null,
              commitCount: ls[0],
              lastCommitAt: ls[1],
              branchCount: ls[2],
            }
          : r,
      ),
    }));
  },

  enrichAi: async () => {
    const targets = get().repos;
    for (const repo of targets) {
      // Skip if Apple Intelligence already reported unavailable this session.
      if (get().aiUnavailableReason !== null) break;
      const ctx = await buildAiContext(repo);
      const hash = inputHash(ctx);
      const cached = get().aiCache[repo.path];
      if (cached && cached.inputHash === hash) continue; // fresh — skip

      set((s) => ({ analyzingPaths: new Set(s.analyzingPaths).add(repo.path) }));
      let result: AiResult;
      try {
        const raw = await invoke<string>('ai_analyze', { context: ctx });
        result = JSON.parse(raw) as AiResult;
      } catch (err) {
        // IPC/parse failure — NOT a model generation failure. Keep the codes
        // distinct so 'generation' always means the sidecar's own failure.
        result = { ok: false, error: 'invoke_failed', reason: errorMessage(err) };
      }
      set((s) => {
        const next = new Set(s.analyzingPaths);
        next.delete(repo.path);
        return { analyzingPaths: next };
      });

      if (result.ok && result.summary) {
        const entry: AiCacheEntry = {
          summary: result.summary,
          tags: result.tags ?? [],
          model: result.model ?? 'unknown',
          analyzedAt: new Date().toISOString(),
          inputHash: hash,
        };
        set((s) => ({
          aiCache: { ...s.aiCache, [repo.path]: entry },
          repos: s.repos.map((r) =>
            r.path === repo.path ? { ...r, aiSummary: entry.summary, aiTags: entry.tags } : r,
          ),
        }));
        void get().save();
      } else if (result.error === 'unavailable') {
        set({ aiUnavailableReason: result.reason ?? 'unavailable' });
        break; // stop the queue — no point continuing this session
      }
      // other errors: skip this repo, continue.
    }
  },

  enrichAiOne: async (path) => {
    const repo = get().repos.find((r) => r.path === path);
    if (!repo) return;
    const ctx = await buildAiContext(repo);
    const hash = inputHash(ctx);
    set((s) => ({ analyzingPaths: new Set(s.analyzingPaths).add(path) }));
    let result: AiResult;
    try {
      result = JSON.parse(await invoke<string>('ai_analyze', { context: ctx })) as AiResult;
    } catch (err) {
      // IPC/parse failure — NOT a model generation failure (see enrichAi).
      result = { ok: false, error: 'invoke_failed', reason: errorMessage(err) };
    }
    set((s) => {
      const n = new Set(s.analyzingPaths);
      n.delete(path);
      return { analyzingPaths: n };
    });
    if (result.ok && result.summary) {
      const entry: AiCacheEntry = {
        summary: result.summary,
        tags: result.tags ?? [],
        model: result.model ?? 'unknown',
        analyzedAt: new Date().toISOString(),
        inputHash: hash,
      };
      set((s) => ({
        aiCache: { ...s.aiCache, [path]: entry },
        repos: s.repos.map((r) =>
          r.path === path ? { ...r, aiSummary: entry.summary, aiTags: entry.tags } : r,
        ),
      }));
      void get().save();
    } else if (result.error === 'unavailable') {
      set({ aiUnavailableReason: result.reason ?? 'unavailable' });
    }
  },

  setDebugBannerEnabled: async (enabled) => {
    set((s) => ({ settings: { ...s.settings, debugBannerEnabled: enabled } }));
    await get().save();
  },

  setEditorCommand: async (command) => {
    set((s) => ({ settings: { ...s.settings, editorCommand: command } }));
    await get().save();
  },

  setEditorApp: async (app) => {
    set((s) => ({ settings: { ...s.settings, editorApp: app } }));
    await get().save();
  },

  setTerminalApp: async (app) => {
    set((s) => ({ settings: { ...s.settings, terminalApp: app } }));
    await get().save();
  },

  addDayNote: (note) => {
    set((s) => {
      const notes = [...s.dayNotes.notes, note];
      if (notes.length > 90) notes.splice(0, notes.length - 90);
      return { dayNotes: { ...s.dayNotes, notes } };
    });
    void get().save();
  },

  clearDayNotes: () => {
    set((s) => ({ dayNotes: { ...s.dayNotes, notes: [] } }));
    void get().save();
  },

  deleteDayNote: (id) => {
    set((s) => ({
      dayNotes: { ...s.dayNotes, notes: s.dayNotes.notes.filter((n) => n.id !== id) },
    }));
    void get().save();
  },

  addChatSession: (session) => {
    set((s) => ({
      chatSessions: { ...s.chatSessions, sessions: [...s.chatSessions.sessions, session] },
    }));
    void get().save();
  },

  updateChatSessionStatus: (id, status, exitCode) => {
    set((s) => ({
      chatSessions: {
        ...s.chatSessions,
        sessions: s.chatSessions.sessions.map((sess) =>
          sess.id === id ? { ...sess, status, exitCode } : sess,
        ),
      },
    }));
    void get().save();
  },

  deleteChatSession: (id) => {
    set((s) => ({
      chatSessions: {
        ...s.chatSessions,
        sessions: s.chatSessions.sessions.filter((sess) => sess.id !== id),
      },
    }));
    void get().save();
  },

  addUserNote: (body) => {
    // Human-written note: no AI window, so both window bounds collapse to now.
    const now = new Date().toISOString();
    const note: DayNote = {
      id: crypto.randomUUID(),
      generatedAt: now,
      windowStart: now,
      windowEnd: now,
      body,
      repoRefs: extractRepoRefs(body),
      model: 'user',
      trigger: 'user',
    };
    get().addDayNote(note);
  },

  updateDayNote: (id, body) => {
    set((s) => ({
      dayNotes: {
        ...s.dayNotes,
        notes: s.dayNotes.notes.map((n) =>
          n.id === id
            ? { ...n, body, editedAt: new Date().toISOString(), repoRefs: extractRepoRefs(body) }
            : n,
        ),
      },
    }));
    void get().save();
  },

  setAutoNotesEnabled: (enabled) => {
    set((s) => ({ settings: { ...s.settings, autoNotesEnabled: enabled } }));
    void get().save();
    // Skip the immediate fire: the user is changing a setting, not starting a
    // session. Only the App.tsx startup path should fire immediately.
    get().setupAutoNotesTimer({ skipImmediateFire: true });
  },

  setAutoNotesIntervalMin: (min) => {
    set((s) => ({ settings: { ...s.settings, autoNotesIntervalMin: min } }));
    void get().save();
    // Skip the immediate fire: NotesTab calls this on every valid keystroke
    // while the user types an interval (e.g. "1", "12", "120"). Firing
    // generateDayNotes on every keystroke would create unwanted duplicate notes.
    get().setupAutoNotesTimer({ skipImmediateFire: true });
  },

  generateDayNotes: async (trigger) => {
    if (get().generatingNotes) return;
    set({ generatingNotes: true, notesError: null });
    try {
      const now = Date.now();
      // Session-anchored window: start where the last note ended so each note
      // covers "what happened since the previous one". Clamped to [1h, 7d] so
      // a very recent note still yields a useful window and a long absence
      // doesn't blow up the context size.
      const notes = get().dayNotes.notes;
      // Anchor on the last AI-generated note, not any user-written note.
      // A hand-written note at 5pm must not silently drop 9am–4pm activity by
      // moving the window start forward to 4pm (due to the 1h minimum clamp).
      const lastAiNote = [...notes].reverse().find((n) => n.trigger !== 'user');
      const lastMs = lastAiNote ? Date.parse(lastAiNote.generatedAt) : NaN;

      // For auto triggers: skip silently when the last AI note is still within
      // the configured interval. This prevents duplicate notes on app restart
      // when there was activity in the past hour that the previous note already
      // covered. Manual triggers always proceed.
      if (trigger === 'auto' && Number.isFinite(lastMs)) {
        const { autoNotesIntervalMin } = get().settings;
        const intervalMs = (autoNotesIntervalMin > 0 ? autoNotesIntervalMin : 60) * 60 * 1000;
        if (now - lastMs < intervalMs) {
          return;
        }
      }

      let windowStartMs = Number.isFinite(lastMs) ? lastMs : now - 86400000;
      windowStartMs = Math.max(windowStartMs, now - 7 * 86400000);
      // Do NOT apply the 1-hour minimum clamp here: if the last AI note is only
      // a few minutes old (e.g. a manual re-run), an artificially widened window
      // would duplicate activity. The auto-trigger guard above already prevents
      // running too soon. For manual runs within a short window, honour the
      // actual elapsed time and let the "no activity found" path handle it.
      // Exception: if there is no prior note, default to 1 day back (handled
      // above by the NaN branch) and still apply no artificial minimum.
      const windowStart = new Date(windowStartMs).toISOString();
      const windowEnd = new Date(now).toISOString();

      const token = await invoke<string | null>('get_token').catch((e: unknown) => {
        // Rust returns Ok(None) (→ null) when no token is stored; a rejection here
        // is a genuine Keychain access failure, not "no token". Surface it.
        console.error('[keychain] get_token failed', errorMessage(e));
        return null;
      });

      const login = token ? await fetchUserLogin(token).catch(() => null) : null;
      const allEvents =
        login && token ? await fetchUserEvents(login, token, windowStart).catch(() => []) : [];

      const repos = get().repos;
      // SHA-based dedup set shared across repos to avoid cross-repo collisions
      const seenShas = new Set<string>();
      const repoData = await Promise.all(
        repos.map(async (r) => {
          // 1. Local git commits (fast, works offline) — now returns CommitDetail[]
          const rawCommits = await invoke<CommitDetail[]>('git_commits_since_numstat', {
            path: r.path,
            sinceIso: windowStart,
          }).catch(() => [] as CommitDetail[]);
          // Defensive: tolerate a malformed backend response rather than throwing.
          let localCommits = Array.isArray(rawCommits) ? rawCommits : [];

          // Uncommitted work summary (diff --stat vs HEAD + untracked count).
          // Backend returns '' on clean tree or any git failure — never throws.
          const dirtyStat = await invoke<string>('git_dirty_stat', { path: r.path }).catch(
            () => '',
          );

          // SHA-based dedup: filter out commits already seen from other repos
          localCommits = localCommits.filter((c) => {
            if (seenShas.has(c.sha)) return false;
            seenShas.add(c.sha);
            return true;
          });

          // Extract issue refs from subjects across all local commits
          const issueRefSet = new Set<string>();
          for (const c of localCommits) {
            const matches = c.subject.matchAll(/#(\d+)/g);
            for (const m of matches) issueRefSet.add(`#${m[1]}`);
          }

          // 2. GitHub API commits + PR titles (richer, catches remote-only activity)
          const prLines: string[] = [];
          let ghCommitLines: string[] = [];
          const coords = r.remoteUrl ? parseRemote(r.remoteUrl) : null;
          const ciRuns =
            coords && token
              ? await fetchCIOutcomes(coords.owner, coords.repo, token, windowStart).catch(() => [])
              : [];
          if (coords && token) {
            const headers: Record<string, string> = {
              Authorization: `token ${token}`,
              Accept: 'application/vnd.github+json',
            };

            // Helper: fetch with a hard 8-second timeout. Returns null on
            // network error or timeout; throws on 429 so the outer loop can
            // bail out early with a user-friendly rate-limit message.
            const fetchWithTimeout = async (url: string): Promise<Response | null> => {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 8000);
              try {
                const res = await fetch(url, { headers, signal: controller.signal });
                clearTimeout(timer);
                if (res.status === 429) {
                  throw new RateLimitError();
                }
                return res;
              } catch (err) {
                clearTimeout(timer);
                if (err instanceof RateLimitError) throw err;
                // AbortError or network error — treat as a soft miss for this repo.
                return null;
              }
            };

            const [commitsRes, prsRes] = await Promise.all([
              fetchWithTimeout(
                `https://api.github.com/repos/${coords.owner}/${coords.repo}/commits?since=${windowStart}&per_page=20`,
              ),
              fetchWithTimeout(
                `https://api.github.com/repos/${coords.owner}/${coords.repo}/pulls?state=all&sort=updated&per_page=10`,
              ),
            ]);
            if (commitsRes?.ok) {
              const data = (await commitsRes.json().catch(() => [])) as Array<{
                sha: string;
                commit: { message: string };
                author?: { login?: string };
              }>;
              for (const c of data) {
                // Skip commits already covered by the local numstat scan —
                // --branches means nearly every pushed commit would duplicate.
                if (seenShas.has(c.sha)) continue;
                seenShas.add(c.sha);
                const subject = c.commit.message.split('\n')[0];
                const authorLogin = c.author?.login;
                const line = authorLogin ? `[${authorLogin}] ${subject}` : subject;
                // Also extract issue refs from gh commit subjects
                const matches = subject.matchAll(/#(\d+)/g);
                for (const m of matches) issueRefSet.add(`#${m[1]}`);
                ghCommitLines.push(line);
              }
            }
            if (prsRes?.ok) {
              const prs = (await prsRes.json().catch(() => [])) as Array<{
                number: number;
                title: string;
                state: string;
                updated_at: string;
              }>;
              const recentPrs = prs.filter((pr) => pr.updated_at >= windowStart);
              // Fetch enriched PR details for top 3; fall back to plain title for the rest
              const prDetails = await Promise.all(
                recentPrs
                  .slice(0, 3)
                  .map((pr) =>
                    fetchPRDetails(coords.owner, coords.repo, pr.number, token).catch(() => null),
                  ),
              );
              prLines.push(
                ...prDetails.filter(Boolean).map((pr) => formatPRLine(pr!)),
                ...recentPrs.slice(3).map((pr) => `[PR #${pr.number}] ${pr.title}`),
              );
            }
          }

          // Build EnrichedRepoEntry and format with shared utility
          const entry: EnrichedRepoEntry = {
            repoName: r.name,
            commits: localCommits,
            prs: prLines,
            events: allEvents
              .filter((e) => e.repo.endsWith('/' + r.name))
              .map((e) => '[event] ' + e.summary),
            ciLines: ciRuns.map(formatCILine),
          };
          const contextLines = formatRepoContext(entry);

          // Append issue refs line if any were found
          if (issueRefSet.size > 0) {
            contextLines.push(`[refs] ${[...issueRefSet].sort().join(' ')}`);
          }

          // Also include gh-only commit lines (not in local numstat) as plain lines
          if (ghCommitLines.length > 0) {
            contextLines.push(...ghCommitLines);
          }

          // Uncommitted changes count as activity: a dirty-only repo must still
          // pass the activeRepoData filter (contextLines.length > 0) below.
          if (dirtyStat !== '') {
            contextLines.push('[uncommitted] ' + dirtyStat);
          }

          // Structured stats for the deterministic report skeleton: committed
          // numbers from numstat plus the parsed dirty stat.
          const dirty = parseDirtyStat(dirtyStat);
          const committedFiles = new Set<string>();
          let committedIns = 0;
          let committedDel = 0;
          for (const c of localCommits) {
            for (const f of c.files) committedFiles.add(f);
            committedIns += c.added;
            committedDel += c.deleted;
          }
          const activity: RepoActivity = {
            name: r.name,
            filesChanged: committedFiles.size + dirty.files,
            insertions: committedIns + dirty.insertions,
            deletions: committedDel + dirty.deletions,
            untracked: dirty.untracked,
            commitSubjects: localCommits.slice(0, 3).map((c) => c.subject),
          };

          // Number-free lines for the AI executive summary — the on-device
          // model parrots (and miscomputes) any digits it is shown, so it gets
          // only commit subjects, PR/CI/event titles, and a qualitative digest.
          const aiLines: string[] = [
            ...activity.commitSubjects.map((s) => 'commit: ' + s),
            ...entry.prs.map((p) => p.replace(/\s*\(\+\d+\/-\d+,\s*\d+\s*files?\)/g, '')),
            ...entry.ciLines,
            ...entry.events,
          ];
          const digest = qualitativeDigest(activity);
          if (digest) aiLines.push(digest);

          return { name: r.name, commits: contextLines, activity, aiLines };
        }),
      );

      // Only include repos that have activity in the window
      const activeRepoData = repoData.filter((r) => r.commits.length > 0);

      if (activeRepoData.length === 0) {
        // Manual click deserves feedback; a recurring auto run with a quiet
        // window should not paint an error banner.
        if (trigger === 'manual') {
          set({ notesError: 'No activity found since the last note.' });
        }
        return;
      }

      // Cap total context before sending to sidecar. The AI sees only the
      // number-free digest lines; the numeric stats live in the composed report.
      const cappedRepoData = capItemsToContextBudget(
        capContextLines(
          activeRepoData.map(({ name, aiLines }) => ({ name, commits: aiLines })),
          8000,
        ),
        (repos) => JSON.stringify({ mode: 'day_notes', repos }),
      );

      // The report skeleton (tiers, metrics, per-repo stats) is deterministic;
      // Apple Intelligence contributes only the executive-summary narrative.
      // An AI failure therefore degrades to a stats-only note, never a no-note.
      let execSummary = '_Apple Intelligence summary unavailable — stats compiled locally._';
      let model = 'local-stats';
      try {
        const raw = await invoke<string>('ai_day_notes', { repos: cappedRepoData });
        const parsed = JSON.parse(raw) as {
          ok: boolean;
          body?: string;
          model?: string;
          error?: string;
        };
        if (parsed.ok && parsed.body) {
          execSummary = parsed.body.trim();
          model = parsed.model ?? 'apple/foundation-models';
        }
      } catch {
        // Sidecar spawn/parse failure — keep the fallback summary.
      }

      const body = composeSessionReport(
        activeRepoData.map((r) => r.activity),
        execSummary,
        new Date(now),
      );

      const note: DayNote = {
        id: crypto.randomUUID(),
        generatedAt: new Date().toISOString(),
        windowStart,
        windowEnd,
        body,
        repoRefs: extractRepoRefs(body),
        model,
        trigger,
      };
      get().addDayNote(note);
      set({ notesError: null });
    } catch (e) {
      if (e instanceof RateLimitError) {
        set({ notesError: 'GitHub API rate limit reached. Wait a moment and try again.' });
      } else {
        set({ notesError: `Error: ${e instanceof Error ? e.message : String(e)}` });
      }
    } finally {
      set({ generatingNotes: false });
    }
  },

  setupAutoNotesTimer: ({ skipImmediateFire = false } = {}) => {
    if (autoNotesTimerRef) {
      clearInterval(autoNotesTimerRef);
      autoNotesTimerRef = null;
    }
    const { autoNotesEnabled, autoNotesIntervalMin } = get().settings;
    if (autoNotesEnabled && autoNotesIntervalMin > 0) {
      // Only fire immediately from the startup path (App.tsx). When called from
      // setAutoNotesEnabled / setAutoNotesIntervalMin (user changing settings),
      // skipImmediateFire is true so we do not create an unwanted note.
      if (!skipImmediateFire) {
        void get().generateDayNotes('auto');
      }
      autoNotesTimerRef = setInterval(
        () => void get().generateDayNotes('auto'),
        autoNotesIntervalMin * 60 * 1000,
      );
    }
  },

  clearNotesError: () => {
    set({ notesError: null });
  },

  storeToken: async (token) => {
    await invoke('store_token', { token });
    set((s) => ({ settings: { ...s.settings, hasToken: true } }));
    await get().save();
  },

  refreshHasToken: async () => {
    try {
      const token = await invoke<string | null>('get_token');
      const hasToken = token !== null && token.length > 0;
      set((s) => ({ settings: { ...s.settings, hasToken } }));
    } catch {
      // Keychain unavailable / stub not yet implemented: treat as no token.
      set((s) => ({ settings: { ...s.settings, hasToken: false } }));
    }
  },
}));
