// Shared contracts for Coruro.
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
  /**
   * Terminal app launched by the card's "Open in terminal" button via
   * `open -a <terminalApp> <repo>` (e.g. "Terminal"/"iTerm"/"Ghostty").
   */
  terminalApp: string;
  /**
   * Auto-refresh interval for GitHub data, in minutes. 0 disables the timer
   * (manual / per-card refresh only).
   */
  refreshIntervalMin: number;
  /** Whether auto day-notes generation is enabled. */
  autoNotesEnabled: boolean;
  /** Auto day-notes generation interval, in minutes. */
  autoNotesIntervalMin: number;
}

/**
 * The board: each column maps to an ordered array of repo absolute paths.
 * Path is the stable identity of a repo across scans.
 */
export type Board = Record<ColumnId, string[]>;

/** Per-repo user-authored metadata, keyed by repo absolute path. */
export type RepoMetadata = Record<string, { notes: string }>;

/**
 * One cached GitHub enrichment, keyed by repo path in AppState.ghCache.
 * Persisted so badges render instantly on launch before the background
 * refresh resolves. `fetchedAt` is the ISO time the data was fetched.
 */
export interface GhCacheEntry {
  gh: RepoGitHub;
  fetchedAt: string;
}

/** Persisted GitHub data cache, keyed by repo absolute path. */
export type GhCache = Record<string, GhCacheEntry>;

/** Context payload sent to the AI sidecar (camelCase matches Rust AiContext). */
export interface AiContext {
  repoName: string;
  description: string | null;
  languages: string[];
  recentCommits: string[];
  topEntries: string[];
  readme: string | null;
}

/** Parsed sidecar result. `ok:true` carries summary+tags; else error/reason. */
export interface AiResult {
  ok: boolean;
  summary?: string;
  tags?: string[];
  model?: string;
  error?: 'unavailable' | 'contextOverflow' | 'generation' | 'badInput' | 'timeout' | 'sidecar_missing';
  reason?: string;
}

/** One persisted AI analysis, keyed by repo path in AppState.aiCache. */
export interface AiCacheEntry {
  summary: string;
  tags: string[];
  model: string;
  analyzedAt: string; // ISO 8601
  inputHash: string;  // hash of the assembled context — drives freshness
}

/** Persisted AI cache, keyed by repo absolute path. */
export type AiCache = Record<string, AiCacheEntry>;

/** Full persisted application state — the shape written to disk. */
export interface AppState {
  settings: Settings;
  board: Board;
  repoMetadata: RepoMetadata;
  /** Cached GitHub enrichment per repo; hydrated into Repo.gh on scan. */
  ghCache: GhCache;
  /** Cached AI analysis per repo; hydrated into Repo.aiSummary/aiTags on scan. */
  aiCache: AiCache;
  /** Persisted day notes from AI summarization service. */
  dayNotes: DayNotesState;
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
  htmlUrl: string; // repo page on github.com
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
  /** Commits ahead of upstream (runtime; null = no upstream / not computed). */
  ahead?: number | null;
  /** Commits behind upstream (runtime; null = no upstream / not computed). */
  behind?: number | null;
  /** Total commits on HEAD (runtime; from git_local_stats). */
  commitCount?: number | null;
  /** Last commit time, ISO 8601 (runtime; null on empty repo). */
  lastCommitAt?: string | null;
  /** Local branch count (runtime; from git_local_stats). */
  branchCount?: number | null;
  /** AI-generated one-line summary; populated by a later AI cycle. */
  aiSummary?: string | null;
  /** AI-generated topic tags; populated by a later AI cycle. */
  aiTags?: string[] | null;
}

/** One day-note generated by the AI summarization service or written by hand. */
export interface DayNote {
  id: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  body: string;
  repoRefs: string[];
  model: string;
  /** 'user' = human-written note (model is 'user', window collapses to generatedAt). */
  trigger: 'manual' | 'auto' | 'user';
  /** ISO timestamp of the last in-app edit; absent until first edited. */
  editedAt?: string;
}

/** Persisted collection of day notes. */
export interface DayNotesState {
  notes: DayNote[];
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
      terminalApp: 'Terminal',
      refreshIntervalMin: 10,
      autoNotesEnabled: false,
      autoNotesIntervalMin: 60,
    },
    board: {
      inbox: [],
      backlog: [],
      active: [],
      review: [],
      done: [],
    },
    repoMetadata: {},
    ghCache: {},
    aiCache: {},
    dayNotes: { notes: [] },
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

/** Full shape persisted to <repo>/coruro_notes.json. */
export interface NotesTimeline {
  version: 1;
  notes: TimelineNote[];
}

// ---------------------------------------------------------------------------
// Claude Command Center inventory
//
// Runtime-only model produced by scanning ~/.claude and ~/.claude.json.
// NEVER persisted (recomputed fresh on each tab open), and NEVER stores
// secret values — only env var NAMES, never their values (see ClaudeSettings).
// Every field tolerates absence: the scanner must never throw on a missing
// or malformed source file (mirrors scanner.ts / scanAndDistribute resilience).
// ---------------------------------------------------------------------------

/** Transport kind for an MCP server, inferred from its config shape. */
export type ClaudeMcpTransport = 'stdio' | 'sse' | 'http' | 'unknown';

/** One configured MCP server, from ~/.claude.json (global or per-project). */
export interface ClaudeMcpServer {
  name: string;
  /** 'global' = top-level mcpServers; 'project' = under projects[path]. */
  scope: 'global' | 'project';
  /** Owning project path when scope === 'project'. */
  projectPath?: string;
  transport: ClaudeMcpTransport;
  /** Launch command for stdio transports (null otherwise). */
  command?: string | null;
  /** Endpoint URL for sse/http transports (null otherwise). */
  url?: string | null;
}

/** One installed skill, from ~/.claude/skills/<dir>/SKILL.md. */
export interface ClaudeSkill {
  /** Frontmatter `name`, falling back to the directory name. */
  name: string;
  /** Frontmatter `description` (null when absent). */
  description: string | null;
  dirName: string;
  path: string;
}

/** One subagent definition, from ~/.claude/agents/<file>.md. */
export interface ClaudeAgent {
  /** Frontmatter `name`, falling back to the filename. */
  name: string;
  description: string | null;
  fileName: string;
  path: string;
}

/** One slash command, from ~/.claude/commands/**/<file>.md. */
export interface ClaudeCommand {
  /** Namespaced from subdirs, e.g. "git/commit". */
  name: string;
  description: string | null;
  path: string;
}

/** One installed plugin, from ~/.claude/plugins/config.json (shape varies). */
export interface ClaudePlugin {
  name: string;
  /** Marketplace/repo source when known. */
  source: string | null;
  enabled: boolean;
}

/** One configured hook: either a settings.json entry or a standalone script. */
export interface ClaudeHook {
  /** Event name, e.g. "Stop", "PreToolUse" ("script" hooks use the script kind). */
  event: string;
  matcher?: string | null;
  /** Truncated command string for display. */
  commandPreview: string;
  source: 'settings' | 'script';
  /** Absolute path for standalone *-hook-*.sh scripts (source === 'script'). */
  scriptPath?: string;
}

/** Permission rule sets from ~/.claude/settings.json. */
export interface ClaudePermissions {
  allow: string[];
  deny: string[];
  ask?: string[];
}

/** Resolved view of ~/.claude/settings.json (secret-free). */
export interface ClaudeSettings {
  model: string | null;
  permissions: ClaudePermissions;
  /** Env var NAMES only — values are deliberately never captured. */
  envKeys: string[];
}

/** Lightweight session/usage stat for one project under ~/.claude/projects. */
export interface ClaudeSessionStat {
  projectSlug: string;
  transcriptCount: number;
}

/** Full inventory of the user's Claude Code setup. */
export interface ClaudeInventory {
  mcpServers: ClaudeMcpServer[];
  skills: ClaudeSkill[];
  agents: ClaudeAgent[];
  commands: ClaudeCommand[];
  plugins: ClaudePlugin[];
  hooks: ClaudeHook[];
  settings: ClaudeSettings | null;
  /** Global ~/.claude/CLAUDE.md presence (body never stored, only its size). */
  globalMemory: { present: boolean; charCount: number } | null;
  sessions: ClaudeSessionStat[];
  /** ISO timestamp of when this inventory was produced. */
  scannedAt: string;
  /** Per-source non-fatal errors; mirrors useBoardStore.lastScanError. */
  errors: string[];
}

/**
 * One "repo" section in the shape the coruro-ai sidecar already accepts for
 * `ai_day_notes` (mode "day_notes"). Reused to feed a secret-free digest of
 * the Claude inventory into the on-device model for the health summary.
 */
export interface AiDayNotesRepo {
  name: string;
  commits: string[];
}
