// ClaudeDetail.tsx — 85vw × 85vh modal for one Claude inventory entity.
//
// Mirrors the BOARD project-detail modal (RepoDetail): portalled to <body>,
// left pane = file tree of the entity's directory, right pane = the selected
// file rendered (markdown or plain text). MCP servers have no backing files, so
// they get a config panel instead. Read-only; secret-free (the raw MCP command
// is never shown — only the sanitized packageHint + url host).

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
import { getFileTree, getMarkdownFile, type TreeNode } from '../../utils/repoDetail';
import { MarkdownBody } from '../shared/MarkdownBody';
import type { ClaudeMcpServer } from '../../types';

// ---------------------------------------------------------------------------
// Entity model — what the card hands the modal on open.
// ---------------------------------------------------------------------------

export type ClaudeDetailEntity =
  | { kind: 'skill'; name: string; path: string; description: string | null; source: string }
  | { kind: 'agent'; name: string; path: string; description: string | null; source: string }
  | { kind: 'command'; name: string; path: string; description: string | null; source: string }
  | { kind: 'mcp'; name: string; server: ClaudeMcpServer; blurb?: string };

/** Parent directory of a file path (POSIX). */
function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(0, i);
}

/** Host of a URL, or null. */
function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// File-tree row (recursive) — dirs toggle, files select.
// ---------------------------------------------------------------------------

function TreeRow({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const pad = { paddingLeft: `${depth * 12 + 8}px` };
  if (node.isDir) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={pad}
          className="w-full flex items-center gap-1 py-1 pr-2 text-xs text-navy-light hover:bg-navy/[0.04] rounded"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {open ? <FolderOpen size={12} /> : <Folder size={12} />}
          <span className="truncate">{node.name}</span>
        </button>
        {open &&
          node.children?.map((c) => (
            <TreeRow
              key={c.path}
              node={c}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
      </div>
    );
  }
  const active = node.path === selected;
  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      style={pad}
      className={`w-full flex items-center gap-1 py-1 pr-2 text-xs rounded ${
        active ? 'bg-sage/20 text-navy font-medium' : 'text-navy-light hover:bg-navy/[0.04]'
      }`}
    >
      <FileText size={12} className="shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function ClaudeDetail({
  entity,
  onClose,
}: {
  entity: ClaudeDetailEntity;
  onClose: () => void;
}) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selected, setSelected] = useState<string>(entity.kind === 'mcp' ? '' : entity.path);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Load the file tree for file-backed entities.
  useEffect(() => {
    if (entity.kind === 'mcp') return;
    let alive = true;
    void (async () => {
      try {
        const res = await getFileTree(dirOf(entity.path));
        if (alive) setTree(res.root);
      } catch {
        if (alive) setTree([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [entity]);

  // Load the selected file's content.
  const loadFile = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const text = await getMarkdownFile(path);
      setContent(text);
    } catch (e) {
      setContent(`*Could not read file:* ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (entity.kind !== 'mcp' && selected !== '') void loadFile(selected);
  }, [selected, entity.kind, loadFile]);

  const isMd = selected.toLowerCase().endsWith('.md');

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-navy/40 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        className="w-[85vw] h-[85vh] bg-cream rounded-2xl border border-warm-gray shadow-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-warm-gray bg-cream/60">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-sage/20 text-sage">
            {entity.kind}
          </span>
          <h2 className="text-sm font-semibold text-navy font-mono truncate flex-1">
            {entity.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-lg text-navy-light hover:text-navy hover:bg-navy/8 transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/50"
          >
            <X size={16} />
          </button>
        </div>

        {entity.kind === 'mcp' ? (
          // ── MCP config panel (no backing files) ───────────────────────────
          <div className="flex-1 min-h-0 overflow-y-auto p-6">
            <div className="max-w-xl mx-auto rounded-xl border border-warm-gray bg-cream/60 divide-y divide-warm-gray/50">
              {(
                [
                  ['Name', entity.server.name],
                  ['Scope', entity.server.scope],
                  ['Transport', entity.server.transport],
                  ['Source', entity.server.source],
                  ['Package', entity.server.packageHint ?? '—'],
                  ['Host', hostOf(entity.server.url) ?? '—'],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-light w-24 shrink-0">
                    {k}
                  </span>
                  <span className="text-sm font-mono text-navy break-all">{v}</span>
                </div>
              ))}
            </div>
            {entity.blurb && (
              <div className="max-w-xl mx-auto mt-4 rounded-xl border border-warm-gray bg-cream/60 p-4">
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-tertiary/20 text-tertiary mr-2">
                  AI
                </span>
                <span className="text-sm text-navy-light">{entity.blurb}</span>
              </div>
            )}
          </div>
        ) : (
          // ── File-backed entity (skill/agent/command) ──────────────────────
          <div className="flex-1 min-h-0 flex">
            {/* Left: file tree */}
            <div className="w-64 shrink-0 border-r border-warm-gray overflow-y-auto py-2 bg-cream/40">
              {tree.length === 0 ? (
                <p className="px-3 py-2 text-xs text-navy-light">No files.</p>
              ) : (
                tree.map((n) => (
                  <TreeRow
                    key={n.path}
                    node={n}
                    depth={0}
                    selected={selected}
                    onSelect={setSelected}
                  />
                ))
              )}
            </div>
            {/* Right: content */}
            <div className="flex-1 min-w-0 overflow-y-auto p-6">
              {entity.description && (
                <p className="text-xs text-navy-light mb-4 pb-3 border-b border-warm-gray/50">
                  {entity.description}
                </p>
              )}
              {loading ? (
                <p className="text-sm text-navy-light animate-pulse">Loading…</p>
              ) : isMd ? (
                <MarkdownBody compact>{content}</MarkdownBody>
              ) : (
                <pre className="text-xs font-mono text-navy/90 whitespace-pre-wrap break-words">
                  {content}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
