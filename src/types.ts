// Shared contracts for MyGITdash.
// Strict TS, zero `any`, all exports. Everything imports from here.
// Persisted JSON schema lives at ~/.repo_dashboard_state.json.
// Raw GitHub token is NOT stored here — it lives in the macOS Keychain
// (service "repo_dashboard", account "github_pat"). `hasToken` is the
// disk-safe flag the UI uses to know whether a token has been set.

/** The five Kanban columns, in display order. */
export type ColumnId = 'inbox' | 'backlog' | 'active' | 'review' | 'done';

/** Ordered list of all column ids — single source of truth for iteration. */
export const COLUMN_IDS: readonly ColumnId[] = [
  'inbox',
  'backlog',
  'active',
  'review',
  'done',
] as const;

/**
 * Persisted user settings.
 * `rootDirectory` is the absolute path of the folder scanned for repos
 * (null until the user picks one). `hasToken` mirrors Keychain presence —
 * the raw token never lands in JSON.
 */
export interface Settings {
  rootDirectory: string | null;
  hasToken: boolean;
  /**
   * Whether the top-bar debug banner is shown. Defaults true; the user can
   * dismiss it ("Don't show again") or toggle it from Settings. A blocking
   * scan error always shows regardless of this flag.
   */
  debugBannerEnabled: boolean;
  /**
   * Editor launch config. The "Open in editor" button tries `editorCommand`
   * (a CLI binary on PATH, e.g. "code"/"cursor"/"antigravity") first; if that
   * fails it falls back to `open -a <editorApp> <repo>` (a macOS app name,
   * e.g. "Visual Studio Code"/"Antigravity").
   */
  editorCommand: string;
  editorApp: string;
}

/**
 * The board: each column maps to an ordered array of repo absolute paths.
 * Path is the stable identity of a repo across scans.
 */
export type Board = Record<ColumnId, string[]>;

/** Per-repo user-authored metadata, keyed by repo absolute path. */
export type RepoMetadata = Record<string, { notes: string }>;

/** Full persisted application state — the shape written to disk. */
export interface AppState {
  settings: Settings;
  board: Board;
  repoMetadata: RepoMetadata;
}

/** Latest CI (GitHub Actions) conclusion for the default branch. */
export type CiStatus = 'success' | 'failure' | 'pending' | 'none';

/** GitHub-derived, runtime-only repo data. Recomputed on each scan. */
export interface RepoGitHub {
  stars: number;
  forks: number;
  isPrivate: boolean;
  archived: boolean;
  openIssues: number; // true issues = open_issues_count − prCount
  prCount: number;
  ciStatus: CiStatus;
  latestRelease: { tag: string; publishedAt: string } | null;
  description: string | null;
  topics: string[];
  language: string | null; // primary language
  license: string | null; // SPDX id, e.g. "MIT"
  defaultBranch: string;
  pushedAt: string; // ISO 8601
  watchers: number; // subscribers_count
  updatedAt: string; // updated_at (ISO 8601)
  disabled: boolean;
  fork: boolean;
  parent: { fullName: string; url: string } | null; // upstream; null unless a fork
  homepage: string | null;
  hasIssues: boolean;
  hasWiki: boolean;
  hasPages: boolean;
  size: number; // KB, as GitHub reports
}

/**
 * Runtime-only view of a repo, derived by scanning the filesystem and
 * (optionally) the GitHub API. Never persisted — recomputed on each scan.
 */
export interface Repo {
  name: string;
  path: string;
  branch: string;
  dirty: boolean;
  prCount: number;
  /** origin remote URL captured at scan time (null when no origin). */
  remoteUrl?: string | null;
  /** GitHub enrichment; null = no github.com remote or fetch failed. */
  gh?: RepoGitHub | null;
}

/** Factory for a fresh, empty app state matching PRD §6 (minus raw token). */
export function createEmptyAppState(): AppState {
  return {
    settings: {
      rootDirectory: null,
      hasToken: false,
      debugBannerEnabled: true,
      editorCommand: 'code',
      editorApp: 'Visual Studio Code',
    },
    board: {
      inbox: [],
      backlog: [],
      active: [],
      review: [],
      done: [],
    },
    repoMetadata: {},
  };
}

/** Fixed note categories for the per-repo notes timeline. */
export type NoteType = 'thought' | 'idea' | 'todo' | 'bug' | 'question';

/** Ordered list of note types — single source of truth for the type selector. */
export const NOTE_TYPES: readonly NoteType[] = [
  'thought',
  'idea',
  'todo',
  'bug',
  'question',
] as const;

/** One entry in a repo's notes timeline. */
export interface TimelineNote {
  id: string; // crypto.randomUUID()
  type: NoteType;
  body: string;
  createdAt: string; // ISO 8601 (new Date().toISOString())
}

/** Full shape persisted to <repo>/mygitdash_notes.json. */
export interface NotesTimeline {
  version: 1;
  notes: TimelineNote[];
}
