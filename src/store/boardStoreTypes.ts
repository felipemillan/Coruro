// Public type for the Coruro board store.
//
// BoardStore is the single source of truth for the store's shape (persisted
// AppState plus runtime fields and actions). It lives in its own module so the
// slice creators can import it without a cycle through the composition root
// (useBoardStore.ts). The public hook API is unchanged.

import {
  type AppState,
  type ColumnId,
  type Repo,
  type DayNote,
  type ChatSession,
  type ActivityEvent,
} from '../types';

export interface BoardStore extends AppState {
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
  /** Set the Catppuccin terminal colour theme ('mocha' | 'latte') and persist. */
  setTerminalTheme: (theme: 'mocha' | 'latte') => Promise<void>;
  /** Toggle the terminal bell audio beep and persist. */
  setBellAudioEnabled: (enabled: boolean) => Promise<void>;
  /** Toggle the terminal bell visual flash and persist. */
  setBellVisualEnabled: (enabled: boolean) => Promise<void>;

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

  /** Append an in-app activity event and persist. */
  logActivity: (event: ActivityEvent) => void;
  /** Query activity events in a time window (ISO string boundaries). */
  eventsInWindow: (windowStartIso: string, windowEndIso: string) => ActivityEvent[];
  /** Clear all activity events and persist. */
  clearActivityLog: () => void;

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
