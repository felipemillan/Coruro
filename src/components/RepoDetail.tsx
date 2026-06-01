// RepoDetail.tsx — 85vw × 85vh modal for one repo.
//
// Left pane:  markdown-only file tree (recursive, capped). Rows are clickable.
// Right pane: split — top renders the selected .md (default README); bottom is
//             the notes timeline (typed, chat-style) backed by mygitdash_notes.json.
//
// Portalled to <body> so the header's backdrop-blur can't clip it.

import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  X,
  FileText,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  Star,
  GitPullRequest,
  GitCommit,
  CircleDot,
  ExternalLink,
  Tag,
  Eye,
} from 'lucide-react';
import {
  getReadme,
  getMarkdownTree,
  getMarkdownFile,
  type ReadmeResult,
  type FileTreeResult,
  type TreeNode,
} from '../utils/repoDetail';
import {
  readTimeline,
  writeTimeline,
  migrateLegacy,
  makeNote,
  TYPE_LABEL,
} from '../utils/notesTimeline';
import { NOTE_TYPES, type Repo, type NotesTimeline, type NoteType } from '../types';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { parseRemote } from '../utils/github';
import { fetchActivity, type GhActivity } from '../utils/githubActivity';

/** Compact relative age like "3d"/"5h"/"2w" from an ISO timestamp; '' when empty/bad. */
function relativeAge(iso: string): string {
  if (iso === '') return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.max(0, (Date.now() - then) / 1000);
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d`;
  if (sec < 2629800) return `${Math.floor(sec / 604800)}w`;
  return `${Math.floor(sec / 2629800)}mo`;
}

/** Format a GitHub repo size (KB) as "N KB" or "N.N MB". */
function formatSize(kb: number): string {
  return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

interface RepoDetailProps {
  repo: Repo;
  onClose: () => void;
}

/** Crypto-random id with a timestamp fallback if randomUUID is unavailable. */
function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `n-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ---------------------------------------------------------------------------
// Recursive tree row — directories toggle, files select.
// ---------------------------------------------------------------------------

function TreeRow({
  node,
  depth,
  expanded,
  toggle,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
  selectedPath: string | null;
  onSelect: (node: TreeNode) => void;
}) {
  const isOpen = expanded.has(node.path);
  const pad = { paddingLeft: `${depth * 14 + 8}px` };

  if (!node.isDir) {
    const active = selectedPath === node.path;
    return (
      <button
        type="button"
        onClick={() => onSelect(node)}
        className={`flex items-center gap-1.5 w-full py-0.5 text-[12px] font-mono truncate text-left transition-colors cursor-pointer ${
          active ? 'bg-sage/20 text-navy' : 'text-navy-light hover:bg-warm-gray'
        }`}
        style={pad}
        title={node.path}
      >
        <FileText size={12} strokeWidth={1.5} className="shrink-0 text-navy-light/50" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => toggle(node.path)}
        className="flex items-center gap-1 w-full py-0.5 text-[12px] text-navy font-mono hover:bg-warm-gray transition-colors cursor-pointer truncate"
        style={pad}
        title={node.path}
      >
        {isOpen ? (
          <ChevronDown size={12} strokeWidth={1.5} className="shrink-0" />
        ) : (
          <ChevronRight size={12} strokeWidth={1.5} className="shrink-0" />
        )}
        {isOpen ? (
          <FolderOpen size={12} strokeWidth={1.5} className="shrink-0 text-sage" />
        ) : (
          <Folder size={12} strokeWidth={1.5} className="shrink-0 text-sage" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isOpen &&
        node.children?.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity pane — open PRs, recent commits, recent issues (lazy-loaded).
// ---------------------------------------------------------------------------

function ActivityPane({
  activity,
  loading,
  error,
  hasRemote,
  onOpen,
}: {
  activity: GhActivity | null;
  loading: boolean;
  error: string | null;
  hasRemote: boolean;
  onOpen: (url: string) => void;
}) {
  if (!hasRemote) {
    return <p className="px-3 py-2 text-[12px] text-navy-light/50 italic">No github.com remote.</p>;
  }
  if (loading) return <p className="px-3 py-2 text-[12px] text-navy-light/50">Loading activity…</p>;
  if (error !== null) return <p className="px-3 py-2 text-[12px] text-terracotta font-mono">{error}</p>;
  if (activity === null) return null;

  const Row = ({ url, children }: { url: string; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={() => onOpen(url)}
      className="flex items-start gap-1.5 w-full px-3 py-1.5 text-left text-[12px] text-navy-light hover:bg-warm-gray transition-colors cursor-pointer"
      title={url}
    >
      <ExternalLink size={10} strokeWidth={1.5} className="shrink-0 mt-0.5 text-navy-light/40" />
      <span className="truncate">{children}</span>
    </button>
  );

  const Heading = ({ children }: { children: React.ReactNode }) => (
    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-navy-light/50 select-none">
      {children}
    </div>
  );

  const empty = activity.prs.length === 0 && activity.commits.length === 0 && activity.issues.length === 0;
  if (empty) return <p className="px-3 py-2 text-[12px] text-navy-light/50 italic">No recent activity.</p>;

  return (
    <div className="flex flex-col gap-2 pb-2">
      {activity.prs.length > 0 && (
        <section>
          <Heading><GitPullRequest size={10} strokeWidth={1.5} className="inline mr-1" />Open PRs</Heading>
          {activity.prs.map((p) => (
            <Row key={p.number} url={p.url}>
              <span className="font-mono text-navy-light/50">#{p.number}</span> {p.title}
              {p.draft && <span className="ml-1 text-[10px] text-navy-light/40">(draft)</span>}
            </Row>
          ))}
        </section>
      )}
      {activity.commits.length > 0 && (
        <section>
          <Heading><GitCommit size={10} strokeWidth={1.5} className="inline mr-1" />Recent commits</Heading>
          {activity.commits.map((c) => (
            <Row key={c.sha} url={c.url}>
              {c.message} <span className="text-navy-light/40">· {c.author}</span>
            </Row>
          ))}
        </section>
      )}
      {activity.issues.length > 0 && (
        <section>
          <Heading><CircleDot size={10} strokeWidth={1.5} className="inline mr-1" />Recent issues</Heading>
          {activity.issues.map((i) => (
            <Row key={i.number} url={i.url}>
              <span className="font-mono text-navy-light/50">#{i.number}</span> {i.title}
            </Row>
          ))}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function RepoDetail({ repo, onClose }: RepoDetailProps) {
  // Preview state
  const [readme, setReadme] = useState<ReadmeResult | null>(null);
  const [tree, setTree] = useState<FileTreeResult | null>(null);
  const [selected, setSelected] = useState<{ name: string; path: string } | null>(null);
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Left-pane tabs + lazy GitHub activity
  const [tab, setTab] = useState<'files' | 'activity'>('files');
  const [activity, setActivity] = useState<GhActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  // Timeline state
  const [timeline, setTimeline] = useState<NotesTimeline | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [composerType, setComposerType] = useState<NoteType>('thought');
  const [composerBody, setComposerBody] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Load README + markdown tree + timeline on mount / repo change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected(null);
    setPreviewBody(null);
    setTimelineError(null);

    Promise.all([getReadme(repo.path), getMarkdownTree(repo.path)])
      .then(([rm, tr]) => {
        if (cancelled) return;
        setReadme(rm);
        setTree(tr);
        setExpanded(new Set(tr.root.filter((n) => n.isDir).map((n) => n.path)));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Timeline: read JSON; if absent, try migrating legacy .md and persist it.
    (async () => {
      try {
        const existing = await readTimeline(repo.path);
        if (cancelled) return;
        if (existing) {
          setTimeline(existing);
          return;
        }
        const migrated = await migrateLegacy(repo.path, newId(), new Date().toISOString());
        if (cancelled) return;
        if (migrated) {
          await writeTimeline(repo.path, repo.name, migrated);
          if (!cancelled) setTimeline(migrated);
        } else {
          setTimeline({ version: 1, notes: [] });
        }
      } catch (e: unknown) {
        if (!cancelled) setTimelineError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repo.path, repo.name]);

  // Selecting a file loads its body into the preview pane. Guards against an
  // out-of-order resolution when the user clicks another file mid-fetch.
  const onSelect = useCallback((node: TreeNode) => {
    setSelected({ name: node.name, path: node.path });
    setPreviewBody(null);
    getMarkdownFile(node.path)
      .then((body) => {
        setSelected((cur) => {
          if (cur?.path === node.path) setPreviewBody(body);
          return cur;
        });
      })
      .catch((e: unknown) => {
        setSelected((cur) => {
          if (cur?.path === node.path) setPreviewBody(`\n> Failed to read file: ${String(e)}\n`);
          return cur;
        });
      });
  }, []);

  // Scroll the timeline to the newest note after it changes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [timeline]);

  // Persist a timeline change derived from the latest state (functional update),
  // then write to disk. Rolls back to the true prior value on write failure.
  const persist = useCallback(
    (update: (prev: NotesTimeline) => NotesTimeline) => {
      setTimelineError(null);
      setTimeline((prev) => {
        if (!prev) return prev;
        const next = update(prev);
        writeTimeline(repo.path, repo.name, next).catch((e: unknown) => {
          setTimeline(prev); // rollback to the value the user saw
          setTimelineError(e instanceof Error ? e.message : String(e));
        });
        return next;
      });
    },
    [repo.path, repo.name],
  );

  const addNote = useCallback(() => {
    const body = composerBody.trim();
    if (body === '') return;
    const note = makeNote(composerType, body, newId(), new Date().toISOString());
    persist((t) => ({ ...t, notes: [...t.notes, note] }));
    setComposerBody('');
  }, [composerBody, composerType, persist]);

  const deleteNote = useCallback(
    (id: string) => {
      persist((t) => ({ ...t, notes: t.notes.filter((n) => n.id !== id) }));
    },
    [persist],
  );

  // What the preview pane renders: selected file, else README.
  const previewContent = selected
    ? previewBody
    : (readme?.content ?? null);
  const previewTitle = selected ? selected.name : (readme?.name ?? 'README');

  // Lazily fetch PRs/commits/issues the first time the Activity tab opens.
  useEffect(() => {
    if (tab !== 'activity' || activity !== null || activityLoading) return;
    const coords = repo.remoteUrl ? parseRemote(repo.remoteUrl) : null;
    if (coords === null) {
      setActivity({ prs: [], commits: [], issues: [] });
      return;
    }
    let cancelled = false;
    setActivityLoading(true);
    setActivityError(null);
    (async () => {
      try {
        const token = await invoke<string | null>('get_token').catch(() => null);
        const result = await fetchActivity(coords, token ?? undefined);
        if (!cancelled) setActivity(result);
      } catch (e: unknown) {
        if (!cancelled) setActivityError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, activity, activityLoading, repo.remoteUrl]);

  // Reset tab + activity when switching repos.
  useEffect(() => {
    setTab('files');
    setActivity(null);
    setActivityError(null);
    setActivityLoading(false);
  }, [repo.path]);

  const openUrl = useCallback((url: string) => {
    if (url) void openExternal(url);
  }, []);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${repo.name} details`}
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-navy/25"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-[85vw] h-[85vh] bg-cream border border-warm-gray shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-warm-gray border-b border-warm-gray/60 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={14} strokeWidth={1.5} className="text-navy-light shrink-0" />
            <span className="text-[13px] font-semibold text-navy truncate">{repo.name}</span>
            <span className="text-[11px] font-mono text-navy-light/60 truncate">{repo.path}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center w-7 h-7 text-navy-light hover:text-navy hover:bg-navy/10 transition-colors cursor-pointer shrink-0"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>

        {/* GitHub overview band */}
        <div className="shrink-0 px-5 py-2.5 bg-cream/60 border-b border-warm-gray text-[12px] text-navy-light flex items-center gap-3 flex-wrap min-h-[40px]">
          {repo.gh ? (
            <>
              {repo.gh.description && (
                <span className="text-navy truncate max-w-[40%]">{repo.gh.description}</span>
              )}
              {repo.gh.language && <span className="font-mono">{repo.gh.language}</span>}
              {repo.gh.license && <span className="font-mono">{repo.gh.license}</span>}
              <span className="flex items-center gap-1"><Star size={12} strokeWidth={1.75} />{repo.gh.stars}</span>
              <span className="font-mono">⑂ {repo.gh.forks}</span>
              <span title="Open issues">{repo.gh.openIssues} issues</span>
              <span title="Open PRs">{repo.gh.prCount} PRs</span>
              {repo.gh.ciStatus !== 'none' && (
                <span
                  className={
                    repo.gh.ciStatus === 'success'
                      ? 'text-sage flex items-center gap-1'
                      : repo.gh.ciStatus === 'failure'
                        ? 'text-terracotta flex items-center gap-1'
                        : 'text-amber-500 flex items-center gap-1'
                  }
                >
                  <CircleDot size={12} strokeWidth={2} />CI {repo.gh.ciStatus}
                </span>
              )}
              {repo.gh.latestRelease && (
                <span className="flex items-center gap-1 font-mono">
                  <Tag size={12} strokeWidth={1.75} />{repo.gh.latestRelease.tag}
                </span>
              )}
              {repo.gh.topics.length > 0 && (
                <span className="flex items-center gap-1 flex-wrap">
                  {repo.gh.topics.slice(0, 5).map((t) => (
                    <span key={t} className="px-1.5 py-0.5 bg-sage/15 text-sage text-[10px] font-mono">{t}</span>
                  ))}
                </span>
              )}
              <span className="flex items-center gap-1" title="Watchers"><Eye size={12} strokeWidth={1.75} />{repo.gh.watchers}</span>
              {relativeAge(repo.gh.updatedAt) && <span title={`Updated ${repo.gh.updatedAt}`}>updated {relativeAge(repo.gh.updatedAt)}</span>}
              <span className="font-mono">{formatSize(repo.gh.size)}</span>
              <span className="font-mono">branch: {repo.gh.defaultBranch}</span>
              {repo.gh.disabled && <span className="px-1.5 py-0.5 bg-navy/10 text-navy-light text-[10px]">disabled</span>}
              {repo.gh.fork && repo.gh.parent && (
                <button
                  type="button"
                  onClick={() => { if (repo.gh?.parent) void openExternal(repo.gh.parent.url); }}
                  className="text-sage hover:underline cursor-pointer"
                  title="Open upstream repository"
                >
                  fork of {repo.gh.parent.fullName}
                </button>
              )}
              {repo.gh.homepage && (
                <button
                  type="button"
                  onClick={() => { if (repo.gh?.homepage) void openExternal(repo.gh.homepage); }}
                  className="flex items-center gap-1 text-sage hover:underline cursor-pointer"
                  title={repo.gh.homepage}
                >
                  <ExternalLink size={12} strokeWidth={1.75} />homepage
                </button>
              )}
              {(repo.gh.hasIssues || repo.gh.hasWiki || repo.gh.hasPages) && (
                <span className="flex items-center gap-1">
                  {repo.gh.hasIssues && <span className="px-1.5 py-0.5 bg-sage/15 text-sage text-[10px] font-mono">issues</span>}
                  {repo.gh.hasWiki && <span className="px-1.5 py-0.5 bg-sage/15 text-sage text-[10px] font-mono">wiki</span>}
                  {repo.gh.hasPages && <span className="px-1.5 py-0.5 bg-sage/15 text-sage text-[10px] font-mono">pages</span>}
                </span>
              )}
            </>
          ) : (
            <span className="italic text-navy-light/50">No GitHub data (local-only or no github.com remote).</span>
          )}
        </div>

        {/* Body: md tree / activity | (preview / timeline) */}
        <div className="flex flex-1 min-h-0">
          {/* Left pane: Files | Activity tabs */}
          <aside className="w-[280px] shrink-0 border-r border-warm-gray bg-cream/60 flex flex-col min-h-0">
            {/* Tab bar */}
            <div className="shrink-0 flex border-b border-warm-gray">
              <button
                type="button"
                onClick={() => setTab('files')}
                className={`flex-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest transition-colors cursor-pointer ${
                  tab === 'files' ? 'text-navy bg-cream' : 'text-navy-light/60 hover:text-navy'
                }`}
              >
                Files{tree && <span className="ml-1.5 font-mono normal-case tracking-normal text-navy-light/40">{tree.total}{tree.truncated ? '+' : ''}</span>}
              </button>
              <button
                type="button"
                onClick={() => setTab('activity')}
                className={`flex-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest transition-colors cursor-pointer ${
                  tab === 'activity' ? 'text-navy bg-cream' : 'text-navy-light/60 hover:text-navy'
                }`}
              >
                Activity
              </button>
            </div>

            {/* Tab body */}
            <div className="flex-1 overflow-auto py-1 min-h-0">
              {tab === 'files' ? (
                loading ? (
                  <p className="px-3 py-2 text-[12px] text-navy-light/50">Loading…</p>
                ) : tree && tree.root.length > 0 ? (
                  <>
                    {tree.root.map((node) => (
                      <TreeRow
                        key={node.path}
                        node={node}
                        depth={0}
                        expanded={expanded}
                        toggle={toggle}
                        selectedPath={selected?.path ?? null}
                        onSelect={onSelect}
                      />
                    ))}
                    {tree.truncated && (
                      <p className="px-3 py-2 mt-1 text-[11px] text-terracotta">
                        Tree truncated at the entry cap — large repo.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="px-3 py-2 text-[12px] text-navy-light/50 italic">No markdown files.</p>
                )
              ) : (
                <ActivityPane
                  activity={activity}
                  loading={activityLoading}
                  error={activityError}
                  hasRemote={repo.remoteUrl ? parseRemote(repo.remoteUrl) !== null : false}
                  onOpen={openUrl}
                />
              )}
            </div>
          </aside>

          {/* Right: preview (top) + timeline (bottom) */}
          <section className="flex-1 flex flex-col min-h-0">
            {/* Preview */}
            <div className="flex-1 min-h-0 flex flex-col border-b border-warm-gray">
              <div className="shrink-0 px-5 py-2 bg-cream/60 border-b border-warm-gray text-[10px] font-mono text-navy-light/50 truncate select-none">
                {previewTitle}
              </div>
              <div className="flex-1 overflow-auto min-h-0">
                {loading ? (
                  <p className="p-6 text-[13px] text-navy-light/50">Loading…</p>
                ) : error !== null ? (
                  <p className="p-6 text-[13px] text-terracotta font-mono">{error}</p>
                ) : previewContent !== null ? (
                  <div className="markdown-body p-6 max-w-[820px]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewContent}</ReactMarkdown>
                  </div>
                ) : selected && previewBody === null ? (
                  <p className="p-6 text-[13px] text-navy-light/50">Loading file…</p>
                ) : (
                  <p className="p-6 text-[13px] text-navy-light/50 italic">
                    No README found. Pick a markdown file on the left.
                  </p>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className="h-[38%] shrink-0 flex flex-col min-h-0 bg-cream/40">
              <div className="shrink-0 px-5 py-2 flex items-center justify-between border-b border-warm-gray">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-light/60 select-none">
                  Notes timeline
                </span>
                <span className="text-[10px] font-mono text-navy-light/40">mygitdash_notes.json</span>
              </div>

              {/* Notes list (oldest-first, newest at bottom) */}
              <div ref={scrollRef} className="flex-1 overflow-auto px-5 py-3 space-y-2 min-h-0">
                {timelineError !== null ? (
                  <p className="text-[12px] text-terracotta font-mono">
                    Could not load notes: {timelineError}
                  </p>
                ) : !timeline || timeline.notes.length === 0 ? (
                  <p className="text-[12px] text-navy-light/40 italic">
                    No notes yet. Add a thought, idea, todo, bug, or question below.
                  </p>
                ) : (
                  timeline.notes.map((n) => (
                    <div
                      key={n.id}
                      className="group bg-cream border border-navy/10 px-3 py-2 text-[13px] text-navy"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-sage">
                          {TYPE_LABEL[n.type]}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-navy-light/40">
                            {n.createdAt.slice(0, 16).replace('T', ' ')}
                          </span>
                          <button
                            type="button"
                            onClick={() => deleteNote(n.id)}
                            aria-label="Delete note"
                            className="opacity-0 group-hover:opacity-100 text-navy-light/40 hover:text-terracotta transition cursor-pointer"
                          >
                            <Trash2 size={12} strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{n.body}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Composer */}
              <div className="shrink-0 border-t border-warm-gray px-5 py-2 flex items-end gap-2">
                <select
                  value={composerType}
                  onChange={(e) => setComposerType(e.target.value as NoteType)}
                  aria-label="Note type"
                  className="text-[12px] font-mono bg-cream border border-navy/10 px-2 py-1.5 focus:outline-none focus:border-sage/60 cursor-pointer"
                >
                  {NOTE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <textarea
                  value={composerBody}
                  onChange={(e) => setComposerBody(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      addNote();
                    }
                  }}
                  placeholder="New note… (⌘/Ctrl+Enter to add)"
                  rows={2}
                  className="flex-1 resize-none text-[13px] text-navy font-mono leading-relaxed bg-cream border border-navy/10 px-3 py-2 placeholder:text-navy/30 focus:outline-none focus:border-sage/60 transition-colors"
                  aria-label="New note body"
                />
                <button
                  type="button"
                  onClick={addNote}
                  disabled={composerBody.trim() === ''}
                  className="flex items-center gap-1 text-[12px] font-semibold text-cream bg-navy px-3 py-2 hover:bg-navy-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
                >
                  <Plus size={13} strokeWidth={2} />
                  New note
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
