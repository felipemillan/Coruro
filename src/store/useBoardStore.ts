// Zustand store for MyGITdash.
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
import {
  readTextFile,
  writeTextFile,
  exists,
  BaseDirectory,
} from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import {
  type AppState,
  type Board,
  type ColumnId,
  type Repo,
  type RepoGitHub,
  type AiCacheEntry,
  type AiResult,
  COLUMN_IDS,
  createEmptyAppState,
} from '../types';
import { scanRepos } from '../utils/scanner';
import { parseRemote, fetchRepoCard } from '../utils/github';
import { readRepoNotes, writeRepoNotes } from '../utils/notesFile';
import { buildAiContext, inputHash } from '../utils/aiContext';

/** Filename written under the user's home directory. */
const STATE_FILE = '.repo_dashboard_state.json';

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

  /** Read state from disk (or initialise defaults if the file is missing). */
  load: () => Promise<void>;
  /** Persist the current AppState slice to disk. No-op before load completes. */
  save: () => Promise<void>;

  /** Set the scanned root directory, persist, and let the caller trigger a scan. */
  setRootDirectory: (path: string) => Promise<void>;
  /** Move a repo card between/within columns, reordering, then persist. */
  moveCard: (
    repoPath: string,
    from: ColumnId,
    to: ColumnId,
    index: number,
  ) => void;
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

  /** Store a PAT in the Keychain and flip hasToken; persists the flag. */
  storeToken: (token: string) => Promise<void>;
  /** Refresh hasToken from the Keychain (does not expose the raw token). */
  refreshHasToken: () => Promise<void>;
}

/** Serialise only the persisted AppState slice (never runtime fields/token). */
function serialise(state: AppState): string {
  const snapshot: AppState = {
    settings: state.settings,
    board: state.board,
    repoMetadata: state.repoMetadata,
    ghCache: state.ghCache,
    aiCache: state.aiCache,
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

  // settings: only keep correctly-typed primitives, else default.
  const settings = base.settings;
  const rawSettings = parsed.settings;
  if (typeof rawSettings === 'object' && rawSettings !== null) {
    const s = rawSettings as Record<string, unknown>;
    if (typeof s.rootDirectory === 'string') settings.rootDirectory = s.rootDirectory;
    if (typeof s.hasToken === 'boolean') settings.hasToken = s.hasToken;
    if (typeof s.debugBannerEnabled === 'boolean') settings.debugBannerEnabled = s.debugBannerEnabled;
    if (typeof s.editorCommand === 'string' && s.editorCommand.length > 0) settings.editorCommand = s.editorCommand;
    if (typeof s.editorApp === 'string' && s.editorApp.length > 0) settings.editorApp = s.editorApp;
    if (typeof s.terminalApp === 'string' && s.terminalApp.length > 0) settings.terminalApp = s.terminalApp;
    if (typeof s.refreshIntervalMin === 'number' && Number.isFinite(s.refreshIntervalMin) && s.refreshIntervalMin >= 0) {
      settings.refreshIntervalMin = s.refreshIntervalMin;
    }
  }

  // board: every column must be a string[]; coerce anything else to [].
  const board = base.board;
  const rawBoard = parsed.board;
  if (typeof rawBoard === 'object' && rawBoard !== null) {
    const b = rawBoard as Record<string, unknown>;
    for (const col of COLUMN_IDS) {
      const arr = b[col];
      if (Array.isArray(arr)) {
        board[col] = arr.filter((p): p is string => typeof p === 'string');
      }
    }
  }

  // repoMetadata: keep only entries shaped { notes: string }.
  const repoMetadata = base.repoMetadata;
  const rawMeta = parsed.repoMetadata;
  if (typeof rawMeta === 'object' && rawMeta !== null) {
    for (const [key, value] of Object.entries(rawMeta as Record<string, unknown>)) {
      if (typeof value === 'object' && value !== null) {
        const notes = (value as Record<string, unknown>).notes;
        repoMetadata[key] = { notes: typeof notes === 'string' ? notes : '' };
      }
    }
  }

  // ghCache: keep only entries shaped { gh: object, fetchedAt: string }.
  // The nested gh is trusted as-is (it is recomputed on every refresh anyway);
  // a malformed entry is simply dropped rather than crashing hydration.
  const ghCache = base.ghCache;
  const rawCache = parsed.ghCache;
  if (typeof rawCache === 'object' && rawCache !== null) {
    for (const [key, value] of Object.entries(rawCache as Record<string, unknown>)) {
      if (typeof value === 'object' && value !== null) {
        const entry = value as Record<string, unknown>;
        if (typeof entry.gh === 'object' && entry.gh !== null && typeof entry.fetchedAt === 'string') {
          ghCache[key] = { gh: entry.gh as RepoGitHub, fetchedAt: entry.fetchedAt };
        }
      }
    }
  }

  // aiCache: keep only well-shaped entries; drop anything malformed.
  const aiCache = base.aiCache;
  const rawAi = (parsed as { aiCache?: unknown }).aiCache;
  if (rawAi && typeof rawAi === 'object') {
    for (const [key, entry] of Object.entries(rawAi as Record<string, unknown>)) {
      const e = entry as Partial<Record<string, unknown>>;
      if (e && typeof e.summary === 'string' && Array.isArray(e.tags) &&
          typeof e.inputHash === 'string' && typeof e.analyzedAt === 'string') {
        aiCache[key] = {
          summary: e.summary, tags: (e.tags as string[]), model: typeof e.model === 'string' ? e.model : 'unknown',
          analyzedAt: e.analyzedAt, inputHash: e.inputHash,
        };
      }
    }
  }

  return { settings, board, repoMetadata, ghCache, aiCache };
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  ...createEmptyAppState(),
  repos: [],
  loaded: false,
  lastScanError: null,
  analyzingPaths: new Set(),
  aiUnavailableReason: null,

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
    const { settings, board, repoMetadata, ghCache, aiCache } = get();
    const payload = serialise({ settings, board, repoMetadata, ghCache, aiCache });
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
    // Persist to the in-repo mygitdash_notes.md (source of truth), debounced
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
            lastScanError: `Failed to write mygitdash_notes.md: ${e instanceof Error ? e.message : String(e)}`,
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

    // Hydrate notes from each repo's mygitdash_notes.md — the repo file is
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
    const token = await invoke<string | null>('get_token').catch(() => null);

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

    const token = await invoke<string | null>('get_token').catch(() => null);
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
      { ahead: number | null; behind: number | null; commitCount: number; lastCommitAt: string | null; branchCount: number }
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
            ahead: null, behind: null, commitCount: 0, lastCommitAt: null, branchCount: 0,
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
      } catch {
        result = { ok: false, error: 'generation' };
      }
      set((s) => {
        const next = new Set(s.analyzingPaths); next.delete(repo.path);
        return { analyzingPaths: next };
      });

      if (result.ok && result.summary) {
        const entry: AiCacheEntry = {
          summary: result.summary, tags: result.tags ?? [], model: result.model ?? 'unknown',
          analyzedAt: new Date().toISOString(), inputHash: hash,
        };
        set((s) => ({
          aiCache: { ...s.aiCache, [repo.path]: entry },
          repos: s.repos.map((r) =>
            r.path === repo.path ? { ...r, aiSummary: entry.summary, aiTags: entry.tags } : r),
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
    } catch {
      result = { ok: false, error: 'generation' };
    }
    set((s) => { const n = new Set(s.analyzingPaths); n.delete(path); return { analyzingPaths: n }; });
    if (result.ok && result.summary) {
      const entry: AiCacheEntry = {
        summary: result.summary, tags: result.tags ?? [], model: result.model ?? 'unknown',
        analyzedAt: new Date().toISOString(), inputHash: hash,
      };
      set((s) => ({
        aiCache: { ...s.aiCache, [path]: entry },
        repos: s.repos.map((r) => (r.path === path ? { ...r, aiSummary: entry.summary, aiTags: entry.tags } : r)),
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
