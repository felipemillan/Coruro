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

        {/* Body: md tree | (preview / timeline) */}
        <div className="flex flex-1 min-h-0">
          {/* Markdown tree pane */}
          <aside className="w-[280px] shrink-0 border-r border-warm-gray bg-cream/60 flex flex-col min-h-0">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-navy-light/60 border-b border-warm-gray select-none">
              Markdown
              {tree && (
                <span className="ml-2 font-mono normal-case tracking-normal text-navy-light/40">
                  {tree.total}
                  {tree.truncated ? '+ (capped)' : ''}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto py-1">
              {loading ? (
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
