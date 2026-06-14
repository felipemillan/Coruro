// RepoDetail.tsx — 85vw × 85vh modal for one repo.
//
// Left pane:  markdown-only file tree (recursive, capped). Rows are clickable.
// Right pane: split — top renders the selected .md (default README); bottom is
//             the notes timeline (typed, chat-style) backed by coruro_notes.json.
//
// Portalled to <body> so the header's backdrop-blur can't clip it.

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText } from 'lucide-react';
import {
  getReadme,
  getMarkdownTree,
  getMarkdownFile,
  type ReadmeResult,
  type FileTreeResult,
  type TreeNode,
} from '../utils/repoDetail';
import { readTimeline, writeTimeline, migrateLegacy, makeNote } from '../utils/notesTimeline';
import { type Repo, type NotesTimeline, type NoteType } from '../types';
import { safeOpenUrl } from '../utils/openUrl';
import { invoke } from '@tauri-apps/api/core';
import { useBoardStore } from '../store/useBoardStore';
import { parseRemote } from '../utils/github';
import { fetchActivity, type GhActivity } from '../utils/githubActivity';

import { TreeRow } from './repoDetail/TreeRow';
import { ActivityPane } from './repoDetail/ActivityPane';
import { GhOverviewBand } from './repoDetail/GhOverviewBand';
import { BranchesPanel } from './repoDetail/BranchesPanel';
import { PreviewPane } from './repoDetail/PreviewPane';
import { NotesTimeline as NotesTimelinePanel } from './repoDetail/NotesTimeline';

interface RepoDetailProps {
  repo: Repo;
  onClose: () => void;
}

/** Crypto-random id with a timestamp fallback if randomUUID is unavailable. */
function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `n-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function RepoDetail({ repo, onClose }: RepoDetailProps) {
  // Preview state
  const [readme, setReadme] = useState<ReadmeResult | null>(null);
  const [tree, setTree] = useState<FileTreeResult | null>(null);
  const [selected, setSelected] = useState<{ name: string; path: string } | null>(null);
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Right-pane preview mode: markdown doc (README/selected file) or AI summary.
  const [previewMode, setPreviewMode] = useState<'doc' | 'ai'>('doc');

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
    setPreviewMode('doc');
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
  const previewContent = selected ? previewBody : (readme?.content ?? null);
  const previewTitle = selected ? selected.name : (readme?.name ?? 'README');

  // Lazily fetch PRs/commits/issues the first time the Activity tab opens.
  // NOTE: activityLoading is deliberately NOT in the deps/guard. Including it
  // caused the effect to re-run the moment setActivityLoading(true) flipped the
  // dep, whose cleanup set cancelled=true on the in-flight fetch — so the result
  // was discarded and the pane was stuck on "Loading…" forever.
  useEffect(() => {
    if (tab !== 'activity' || activity !== null) return;
    const coords = repo.remoteUrl ? parseRemote(repo.remoteUrl) : null;
    console.debug('[activity] load start', { remoteUrl: repo.remoteUrl, coords });
    if (coords === null) {
      setActivity({ prs: [], commits: [], issues: [] });
      return;
    }
    let cancelled = false;
    setActivityLoading(true);
    setActivityError(null);
    (async () => {
      try {
        const token = await invoke<string | null>('get_token').catch((e: unknown) => {
          console.debug('[activity] get_token failed', e);
          return null;
        });
        console.debug('[activity] token', token ? `present(len ${token.length})` : 'none');
        const result = await fetchActivity(coords, token ?? undefined);
        console.debug('[activity] result', {
          prs: result.prs.length,
          commits: result.commits.length,
          issues: result.issues.length,
          cancelled,
        });
        if (!cancelled) setActivity(result);
      } catch (e: unknown) {
        console.debug('[activity] error', e);
        if (!cancelled) setActivityError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, activity, repo.remoteUrl]);

  // Reset tab + activity + preview mode when switching repos.
  useEffect(() => {
    setTab('files');
    setActivity(null);
    setActivityError(null);
    setActivityLoading(false);
    setPreviewMode('doc');
  }, [repo.path]);

  // AI summary data + controls (live repo fields, cache entry for metadata).
  const aiEntry = useBoardStore((s) => s.aiCache[repo.path] ?? null);
  const analyzing = useBoardStore((s) => s.analyzingPaths.has(repo.path));
  const aiUnavailableReason = useBoardStore((s) => s.aiUnavailableReason);
  const enrichAiOne = useBoardStore((s) => s.enrichAiOne);

  // Branches panel state.
  const [branches, setBranches] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const enrichGitOne = useBoardStore((s) => s.enrichGitOne);

  // Load local branches on mount / repo change.
  useEffect(() => {
    let cancelled = false;
    void invoke<string[]>('git_branches', { path: repo.path })
      .then((b) => {
        if (!cancelled) setBranches(b);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [repo.path]);

  const handleFetch = useCallback(async () => {
    if (fetching) return;
    setFetching(true);
    setFetchError(null);
    try {
      await invoke('git_fetch', { path: repo.path });
      await enrichGitOne(repo.path);
      const b = await invoke<string[]>('git_branches', { path: repo.path });
      setBranches(b);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  }, [fetching, repo.path, enrichGitOne]);

  const openUrl = useCallback((url: string) => {
    if (url) void safeOpenUrl(url);
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
      {/* Modal panel — M3: rounded-2xl shadow-lg */}
      <div className="relative w-[85vw] h-[85vh] bg-cream border border-warm-gray shadow-lg rounded-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-warm-gray border-b border-warm-gray/60 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={14} strokeWidth={1.5} className="text-navy-light shrink-0" />
            <span className="text-[13px] font-semibold text-navy truncate">{repo.name}</span>
            <span className="text-[11px] font-mono text-navy-light/60 truncate">{repo.path}</span>
          </div>
          {/* Icon-only close button — M3: rounded-full */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center w-7 h-7 text-navy-light hover:text-navy hover:bg-navy/8 rounded-full transition-colors cursor-pointer shrink-0"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>

        <GhOverviewBand repo={repo} />

        <BranchesPanel
          branches={branches}
          currentBranch={repo.branch}
          fetching={fetching}
          fetchError={fetchError}
          onFetch={() => {
            void handleFetch();
          }}
        />

        {/* Body: md tree / activity | (preview / timeline) */}
        <div className="flex flex-1 min-h-0 mt-1.5">
          {/* Left pane: Files | Activity tabs */}
          <aside className="w-[280px] shrink-0 border-r border-warm-gray bg-cream/60 flex flex-col min-h-0 rounded-xl mx-2 mb-2">
            {/* Tab bar */}
            <div className="shrink-0 flex border-b border-warm-gray">
              <button
                type="button"
                onClick={() => setTab('files')}
                className={`flex-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest transition-colors cursor-pointer ${
                  tab === 'files' ? 'text-navy bg-cream' : 'text-navy-light/60 hover:text-navy'
                }`}
              >
                Files
                {tree && (
                  <span className="ml-1.5 font-mono normal-case tracking-normal text-navy-light/40">
                    {tree.total}
                    {tree.truncated ? '+' : ''}
                  </span>
                )}
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
                  <p className="px-3 py-2 text-[12px] text-navy-light/50 italic">
                    No markdown files.
                  </p>
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
          <section className="flex-1 flex flex-col min-h-0 mr-2 mb-2">
            <PreviewPane
              previewMode={previewMode}
              onSetPreviewMode={setPreviewMode}
              previewTitle={previewTitle}
              previewContent={previewContent}
              loading={loading}
              error={error}
              hasSelectedFile={selected !== null}
              fileBodyLoading={selected !== null && previewBody === null}
              repo={repo}
              ai={{
                summary: repo.aiSummary ?? aiEntry?.summary,
                tags: repo.aiTags ?? aiEntry?.tags ?? [],
                model: aiEntry?.model ?? null,
                analyzedAt: aiEntry?.analyzedAt ?? null,
                analyzing,
                unavailableReason: aiUnavailableReason,
                onReanalyze: () => void enrichAiOne(repo.path),
              }}
            />

            <NotesTimelinePanel
              timeline={timeline}
              timelineError={timelineError}
              composerType={composerType}
              composerBody={composerBody}
              onComposerTypeChange={setComposerType}
              onComposerBodyChange={setComposerBody}
              onAddNote={addNote}
              onDeleteNote={deleteNote}
            />
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
