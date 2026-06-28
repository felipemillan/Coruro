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
 * Assisted-manual publishing target. Drives the compose URL opened in the
 * user's real browser and the draft formatting. No automated posting — the
 * human pastes and clicks.
 */
export type PublisherTarget = 'linkedin' | 'x' | 'instagram' | 'tiktok' | 'facebook' | 'reddit';

/**
 * The shape a generated post takes for a given network. Drives how segments
 * are composed and how the compose UI presents them.
 */
export type PostFormat = 'single' | 'thread' | 'carousel' | 'story' | 'script';

/**
 * Editorial angle the generated post takes. Drives prompt framing only — never
 * any model arg. Persisted as the default-intent setting and per-history entry.
 */
export type PublisherIntent =
  | 'story'
  | 'lesson'
  | 'launch'
  | 'behind_scenes'
  | 'deep_dive'
  | 'feedback'
  | 'milestone'
  | 'hot_take';

/** Ordered list of all publisher intents — single source of truth for iteration. */
export const PUBLISHER_INTENTS: readonly PublisherIntent[] = [
  'story',
  'lesson',
  'launch',
  'behind_scenes',
  'deep_dive',
  'feedback',
  'milestone',
  'hot_take',
] as const;

/**
 * Generation model id. This is only ever a MATCH KEY — the Rust backend maps it
 * to a whitelisted 'static str via resolve_model; the raw string is never
 * interpolated into claude args. An unknown id is rejected, never spawned.
 */
export type PublisherModel = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';

/** Ordered list of all publisher models — single source of truth for iteration. */
export const PUBLISHER_MODELS: readonly PublisherModel[] = [
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
] as const;

/** One unit of post copy (a single post, thread tweet, slide, or beat). */
export interface PublisherSegment {
  text: string;
}

/**
 * One generated take on a post. RUNTIME-ONLY. `segments` holds the ordered
 * copy units; `title` is an optional headline (null when the format has none).
 */
export interface PublisherVariation {
  id: string;
  title: string | null;
  segments: PublisherSegment[];
}

/**
 * A composed-but-unpublished post. RUNTIME-ONLY — holds the repo slug, target,
 * format, and the generated variations. Never persisted; only the resulting
 * activity event (a `repoName` slug) lands in the activity log.
 */
export interface PublisherDraft {
  repoName: string;
  target: PublisherTarget;
  format: PostFormat;
  /** Editorial angle for this draft. RUNTIME-ONLY — never persisted in the draft. */
  intent: PublisherIntent;
  /** Free-text per-draft steering. RUNTIME-ONLY — NEVER persisted in history. */
  guidance: string;
  /** Generation model match key. RUNTIME-ONLY — resolved to a whitelist in Rust. */
  model: PublisherModel;
  count: 1 | 2 | 3 | 4 | 5;
  variations: PublisherVariation[];
  selectedVariation: number;
  status: 'idle' | 'generating' | 'ready' | 'error';
}

/**
 * One persisted Publisher generation. Metadata + generated copy only — the
 * free-text `guidance` steering box is DELIBERATELY NOT stored here (P0).
 * `repoName` is a slug (display name), never an absolute filesystem path; the
 * validator rejects path-shaped values on load. Mirrors the metadata-only
 * contract of {@link ActivityEvent}.
 */
export interface PublisherHistoryEntry {
  id: string;
  repoName: string;
  target: PublisherTarget;
  format: PostFormat;
  intent: PublisherIntent;
  model: PublisherModel;
  generatedAt: string; // ISO 8601
  variations: PublisherVariation[];
}

/** Persisted collection of Publisher generations (capped on load). */
export interface PublisherHistoryState {
  entries: PublisherHistoryEntry[];
}

/**
 * Hard cap on persisted Publisher history entries; oldest are evicted first.
 * Single source of truth shared by the slice (append-trim) and the validator
 * (on-load tail-trim) so the two limits cannot silently drift.
 */
export const MAX_PUBLISHER_HISTORY = 200;

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
  /**
   * Catppuccin flavour used for the xterm.js terminal in the ASK tab.
   * 'mocha' = dark, 'latte' = light. Defaults to 'mocha'.
   */
  terminalTheme: 'mocha' | 'latte';
  /**
   * Play a short audio beep when the Code-tab terminal receives a bell
   * (Claude Code rings the terminal bell on task-done). Defaults false so the
   * app is silent unless the user opts in.
   */
  bellAudioEnabled: boolean;
  /**
   * Flash the Code-tab terminal border when it receives a bell. Defaults true —
   * a quiet, glanceable "task done" cue that replaces the audio bell.
   */
  bellVisualEnabled: boolean;
  /**
   * Author voice/style guidance prepended to the Publisher generation prompt.
   * Free text, capped on load (see validateSettings). Defaults to ''.
   */
  publisherAuthorVoice: string;
  /** Default Publisher target preselected in the compose UI. Defaults 'linkedin'. */
  publisherDefaultTarget: PublisherTarget;
  /** Default Publisher post format preselected in the compose UI. Defaults 'single'. */
  publisherDefaultFormat: PostFormat;
  /** Default Publisher editorial intent preselected in the compose UI. Defaults 'story'. */
  publisherDefaultIntent: PublisherIntent;
  /** Default Publisher generation model preselected in the compose UI. Defaults 'claude-sonnet-4-6'. */
  publisherDefaultModel: PublisherModel;
}

/**
 * The board: each column maps to an ordered array of repo absolute paths.
 * Path is the stable identity of a repo across scans.
 */
export type Board = Record<ColumnId, string[]>;

/** Per-repo user-authored metadata, keyed by repo absolute path. */
export type RepoMetadata = Record<string, { notes: string; customName?: string }>;

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
  error?:
    | 'unavailable'
    | 'contextOverflow'
    | 'generation'
    | 'badInput'
    | 'timeout'
    | 'sidecar_missing'
    | 'invoke_failed';
  reason?: string;
}

/** One persisted AI analysis, keyed by repo path in AppState.aiCache. */
export interface AiCacheEntry {
  summary: string;
  tags: string[];
  model: string;
  analyzedAt: string; // ISO 8601
  inputHash: string; // hash of the assembled context — drives freshness
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
  /** Persisted ASK-tab chat sessions (metadata only; transcripts never stored). */
  chatSessions: ChatSessionsState;
  /** Persisted in-app activity log (metadata only; secret-free). */
  activityLog: ActivityLogState;
  /** Persisted Publisher generation history (metadata + copy; guidance never stored). */
  publisherHistory: PublisherHistoryState;
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
  /**
   * Attribution string for the note's executive summary.
   *
   * - `'user'`                    — human-written note; no AI involved.
   * - `'local-stats'`             — sidecar never ran (single-repo, app-only,
   *                                 or sidecar spawn/parse failure).
   * - `'ai-gated-fallback'`       — sidecar ran and responded ok:true, but the
   *                                 sanitizer rejected the output (numbers / time-
   *                                 spans / no letters survived). Distinguishes
   *                                 "sidecar ran but gated" from "never ran".
   * - `'apple/foundation-models'` — sidecar ran, output passed the gate.
   */
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

/**
 * One ASK-tab chat session (Claude Code PTY). Metadata only — the terminal
 * transcript/scrollback is NEVER persisted (it can be large and may contain
 * sensitive conversation content). A restored session is read-only history:
 * its PTY process is gone after restart, so `status` is always reconciled to
 * 'ended' on load (see validateAppState).
 */
export interface ChatSession {
  id: string;
  repoPath: string;
  repoName: string;
  /** Empty for sessions started with no prompt; the UI regenerates a label from startedAt. */
  title: string;
  startedAt: number;
  status: 'running' | 'ended';
  exitCode: number | null;
  /** Discriminates Claude Code sessions from independent shell sessions.
   *  Optional for backward-compat: absent on persisted pre-v2 sessions,
   *  treated as 'claude' by the validator on load. */
  kind?: 'claude' | 'shell';
}

/** Persisted collection of ASK chat sessions (metadata only). */
export interface ChatSessionsState {
  sessions: ChatSession[];
}

/**
 * Discriminated union of all in-app activity event kinds.
 * Extend only with new enum-ish string literals — never with free-text kinds.
 */
export type ActivityEventKind =
  | 'ask_session_started'
  | 'ask_session_ended'
  | 'run_command_fired'
  | 'command_center_opened'
  | 'curator_run'
  | 'user_note_written'
  | 'publisher_draft_generated'
  | 'publisher_published';

/**
 * One persisted in-app activity event. Metadata-only and secret-free:
 * - No prompt body, transcript content, or token values are ever stored here.
 * - `repoName` is a slug (display name), never an absolute filesystem path.
 * - `label` is constrained (validator rejects path-shaped or >200-char values).
 * Mirrors the metadata-only contract of {@link ChatSession}.
 */
export interface ActivityEvent {
  id: string;
  ts: number;
  kind: ActivityEventKind;
  repoName: string | null;
  label?: string;
}

/** Persisted collection of in-app activity events (metadata only). */
export interface ActivityLogState {
  events: ActivityEvent[];
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
      terminalTheme: 'mocha',
      bellAudioEnabled: false,
      bellVisualEnabled: true,
      publisherAuthorVoice: '',
      publisherDefaultTarget: 'linkedin',
      publisherDefaultFormat: 'single',
      publisherDefaultIntent: 'story',
      publisherDefaultModel: 'claude-sonnet-4-6',
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
    chatSessions: { sessions: [] },
    activityLog: { events: [] },
    publisherHistory: { entries: [] },
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

/** One configured MCP server, from ~/.claude.json or a plugin's mcp.json. */
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
  /** Origin: 'user' (from ~/.claude.json) or the providing plugin's name. */
  source: string;
  /**
   * Secret-free package/binary identifier derived from the stdio command+args
   * (e.g. "@modelcontextprotocol/server-github"). Flags and flag VALUES are
   * stripped, so no token ever lands here. null when none could be identified.
   */
  packageHint?: string | null;
}

/** One installed skill, from a `<root>/skills/<dir>/SKILL.md`. */
export interface ClaudeSkill {
  /** Frontmatter `name`, falling back to the directory name. */
  name: string;
  /** Frontmatter `description` (null when absent). */
  description: string | null;
  dirName: string;
  path: string;
  /** Origin: 'local' (~/.claude/skills) or the providing plugin's name. */
  source: string;
}

/** One subagent definition, from a `<root>/agents/<file>.md`. */
export interface ClaudeAgent {
  /** Frontmatter `name`, falling back to the filename. */
  name: string;
  description: string | null;
  fileName: string;
  path: string;
  /** Origin: 'local' (~/.claude/agents) or the providing plugin's name. */
  source: string;
}

/** One slash command, from a `.md` file under a `<root>/commands` tree. */
export interface ClaudeCommand {
  /** Namespaced from subdirs, e.g. "git/commit". */
  name: string;
  description: string | null;
  path: string;
  /** Origin: 'local' (~/.claude/commands) or the providing plugin's name. */
  source: string;
}

/** One installed plugin, from ~/.claude/plugins/installed_plugins.json. */
export interface ClaudePlugin {
  name: string;
  /** Marketplace the plugin was installed from (e.g. "claude-plugins-official"). */
  marketplace: string | null;
  /** Legacy/source identifier kept for display (mirrors marketplace). */
  source: string | null;
  /** Resolved active version, or null when unknown. */
  version: string | null;
  /** Enabled state from settings.json `enabledPlugins`. */
  enabled: boolean;
  /** Authoritative one-liner from the plugin's `.claude-plugin/plugin.json`. */
  description: string | null;
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
  /** Epoch ms of the newest transcript (*.jsonl) in the project dir; null if unknown. */
  lastModified: number | null;
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

/** One item sent to the on-device model for a short descriptive blurb. Secret-free. */
export interface ClaudeEnrichItem {
  /** Stable id, e.g. "mcp:posthog" or "session:-Users-admin-Github-Coruro". */
  id: string;
  kind: 'mcp' | 'session';
  /** Secret-free context string (name/transport/url-host or humanized slug). */
  context: string;
}

/** One generated blurb keyed back to a ClaudeEnrichItem.id. */
export interface ClaudeEnrichBlurb {
  id: string;
  text: string;
}

/** Sidecar enrichment response (mirrors ai_day_notes JSON envelope). */
export interface ClaudeEnrichResponse {
  ok: boolean;
  blurbs?: ClaudeEnrichBlurb[];
  model?: string | null;
  error?: string;
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

// ── Setup Curator ───────────────────────────────────────────────────────────
// Deterministic recommendations over the scanned inventory. Computed in TS;
// every number lives in `detail`/`items` and renders without any model. The
// on-device AI layer only NARRATES qualitatively (see ai_curate / CurateSummary)
// and is fed `title` strings ONLY — never `detail` (counts) or `items` (names).

export type CurateCategory = 'remove' | 'consolidate' | 'stale' | 'gap' | 'keep';
export type CurateSeverity = 'info' | 'warn';

/** One deterministic curation finding. */
export interface CurateFinding {
  /** Stable id, e.g. "remove:disabled-plugins". */
  id: string;
  category: CurateCategory;
  severity: CurateSeverity;
  /** Qualitative one-liner — MUST be count-free (safe to hand to the model). */
  title: string;
  /** Deterministic explanation; may contain counts. Never sent to the model. */
  detail: string;
  /** Secret-free entity refs (names/slugs) for the UI. Never sent to the model. */
  items: string[];
}

/** One finding row forwarded to the model — title only, nothing numeric. */
export interface CuratePayloadFinding {
  id: string;
  category: CurateCategory;
  severity: CurateSeverity;
  title: string;
}

/** Secret-free narration payload for the ai_curate sidecar call. */
export interface CuratePayload {
  findings: CuratePayloadFinding[];
  /** Per-category counts (awareness only — the model must never repeat/sum them). */
  summary: Record<CurateCategory, number>;
}

/** Sidecar curate response — NARRATIVE ONLY (mirrors ai_day_notes envelope). */
export interface ClaudeCurateResponse {
  ok: boolean;
  body?: string;
  model?: string | null;
  error?: string;
}
