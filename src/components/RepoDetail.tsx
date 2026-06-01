// RepoDetail.tsx — full-screen-ish (85vw × 85vh) modal for one repo.
//
// Left pane:  recursive file tree (all files on disk, capped — see repoDetail.ts).
// Right pane: rendered README markdown (react-markdown + GFM).
//
// Portalled to <body> so the header's backdrop-blur (a containing block for
// fixed children) cannot clip it — same lesson as the Settings modal.

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  X,
  FileText,
  Folder,
  FolderOpen,
  File as FileIcon,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import {
  getReadme,
  getFileTree,
  type ReadmeResult,
  type FileTreeResult,
  type TreeNode,
} from '../utils/repoDetail';
import { useBoardStore } from '../store/useBoardStore';
import type { Repo } from '../types';

interface RepoDetailProps {
  repo: Repo;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Recursive tree row
// ---------------------------------------------------------------------------

function TreeRow({
  node,
  depth,
  expanded,
  toggle,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  const pad = { paddingLeft: `${depth * 14 + 8}px` };

  if (!node.isDir) {
    return (
      <div
        className="flex items-center gap-1.5 py-0.5 text-[12px] text-navy-light font-mono truncate"
        style={pad}
        title={node.path}
      >
        <FileIcon size={12} strokeWidth={1.5} className="shrink-0 text-navy-light/40" />
        <span className="truncate">{node.name}</span>
      </div>
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
          />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function RepoDetail({ repo, onClose }: RepoDetailProps) {
  const [readme, setReadme] = useState<ReadmeResult | null>(null);
  const [tree, setTree] = useState<FileTreeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const updateNotes = useBoardStore((s) => s.updateNotes);
  const notes = useBoardStore((s) => s.repoMetadata[repo.path]?.notes ?? '');

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

  // Load README + tree on mount / repo change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getReadme(repo.path), getFileTree(repo.path)])
      .then(([rm, tr]) => {
        if (cancelled) return;
        setReadme(rm);
        setTree(tr);
        // Default: top-level directories expanded.
        setExpanded(new Set(tr.root.filter((n) => n.isDir).map((n) => n.path)));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo.path]);

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

        {/* Body: tree | readme */}
        <div className="flex flex-1 min-h-0">
          {/* Tree pane */}
          <aside className="w-[320px] shrink-0 border-r border-warm-gray bg-cream/60 flex flex-col min-h-0">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-navy-light/60 border-b border-warm-gray select-none">
              Files
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
                    />
                  ))}
                  {tree.truncated && (
                    <p className="px-3 py-2 mt-1 text-[11px] text-terracotta">
                      Tree truncated at the entry cap — large repo.
                    </p>
                  )}
                </>
              ) : (
                <p className="px-3 py-2 text-[12px] text-navy-light/50">No files.</p>
              )}
            </div>
          </aside>

          {/* Right pane: notes editor (top) + README (scrolls) */}
          <section className="flex-1 flex flex-col min-h-0">
            {/* Notes — saved to <repo>/mygitdash_notes.md */}
            <div className="shrink-0 border-b border-warm-gray bg-cream/60 px-5 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-light/60 select-none">
                  Notes
                </span>
                <span className="text-[10px] font-mono text-navy-light/40">
                  mygitdash_notes.md
                </span>
              </div>
              <textarea
                value={notes}
                onChange={(e) => updateNotes(repo.path, e.target.value)}
                placeholder="Notes for this repo — saved to mygitdash_notes.md (markdown, commit it to share)…"
                rows={4}
                className="
                  w-full resize-y text-[13px] text-navy font-mono leading-relaxed
                  bg-cream border border-navy/10 px-3 py-2
                  placeholder:text-navy/30
                  focus:outline-none focus:border-sage/60
                  transition-colors
                "
                aria-label={`Notes for ${repo.name}`}
              />
            </div>

            {/* README */}
            <div className="flex-1 overflow-auto min-h-0">
              {loading ? (
                <p className="p-6 text-[13px] text-navy-light/50">Loading README…</p>
              ) : error !== null ? (
                <p className="p-6 text-[13px] text-terracotta font-mono">{error}</p>
              ) : readme !== null ? (
                <div className="markdown-body p-6 max-w-[820px]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{readme.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="p-6 text-[13px] text-navy-light/50 italic">
                  No README found in this repository.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
