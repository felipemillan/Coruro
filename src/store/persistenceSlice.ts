// Persistence slice: disk load/save, the scan→distribute pipeline, notes
// persistence, card moves, and Keychain token flag. Behaviour is identical to
// the inline implementation it replaces; only the home is different.

import { readTextFile, writeTextFile, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { type Board, COLUMN_IDS, createEmptyAppState } from '../types';
import { scanRepos } from '../utils/scanner';
import { readRepoNotes, writeRepoNotes } from '../utils/notesFile';
import type { BoardStore } from './boardStoreTypes';
import {
  type BoardSet,
  type BoardGet,
  STATE_FILE,
  NOTES_DEBOUNCE_MS,
  serialise,
  validateAppState,
} from './boardStoreShared';
import { runtimeEffects } from './runtimeEffects';

type PersistenceSlice = Pick<
  BoardStore,
  | 'load'
  | 'save'
  | 'setRootDirectory'
  | 'moveCard'
  | 'updateNotes'
  | 'setRepos'
  | 'scanAndDistribute'
  | 'storeToken'
  | 'refreshHasToken'
>;

export function createPersistenceSlice(set: BoardSet, get: BoardGet): PersistenceSlice {
  return {
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
      // through the write chain so concurrent saves never interleave partial writes.
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
      return runtimeEffects.enqueueWrite(() =>
        writeTextFile(STATE_FILE, payload, { baseDir: BaseDirectory.Home }),
      );
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
      const timers = runtimeEffects.notesSaveTimers;
      const existing = timers.get(repoPath);
      if (existing !== undefined) clearTimeout(existing);
      timers.set(
        repoPath,
        setTimeout(() => {
          timers.delete(repoPath);
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
      let repos;
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
  };
}
