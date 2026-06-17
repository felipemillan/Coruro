// AskSidebar — left nav panel: a pinned "Github" root-dir shell, a
// "+ start new session" chooser (Shell or Claude), then all other sessions
// grouped by repo with an absolute date-time stamp. Inline-delete undo toast
// lives at the bottom. Extracted from AskTab.tsx for size.

import { useState } from 'react';
import { Trash2, Terminal, Plus } from 'lucide-react';
import type { ChatSession } from '../../types';
import { fmtDateTime } from './askUtils';

interface AskSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  deleteToast: { id: string; label: string } | null;
  /** Id of the pinned root-dir "Github" shell (excluded from the grouped list). */
  githubShellId: string | null;
  githubShellRunning: boolean;
  onOpenGithubShell: () => void;
  onStartShell: () => void;
  onStartClaude: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (session: ChatSession) => void;
  onUndoDelete: () => void;
}

export function AskSidebar({
  sessions,
  activeSessionId,
  deleteToast,
  githubShellId,
  githubShellRunning,
  onOpenGithubShell,
  onStartShell,
  onStartClaude,
  onSelectSession,
  onDeleteSession,
  onUndoDelete,
}: AskSidebarProps) {
  const [chooserOpen, setChooserOpen] = useState(false);

  // Everything except the pinned Github shell, grouped by repo. Map insertion
  // order = newest repo first (sessions are prepended on start).
  const grouped = sessions
    .filter((s) => s.id !== githubShellId)
    .reduce<Map<string, { repoName: string; items: ChatSession[] }>>((acc, s) => {
      if (!acc.has(s.repoPath)) acc.set(s.repoPath, { repoName: s.repoName, items: [] });
      acc.get(s.repoPath)!.items.push(s);
      return acc;
    }, new Map());

  const githubActive = activeSessionId !== null && activeSessionId === githubShellId;

  const choose = (fn: () => void) => {
    fn();
    setChooserOpen(false);
  };

  return (
    <nav
      aria-label="Sessions"
      className="w-[clamp(160px,18vw,220px)] min-w-[160px] shrink-0 border-r border-warm-gray flex flex-col bg-cream/30 overflow-y-auto"
    >
      {/* Pinned Github root-dir shell */}
      <button
        type="button"
        onClick={onOpenGithubShell}
        aria-label="Github shell (root directory)"
        className={`flex items-center gap-2 px-3 py-2 border-b border-warm-gray/60 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage ${
          githubActive
            ? 'bg-sage/20 text-navy'
            : 'text-navy-light/70 hover:text-navy hover:bg-warm-gray/60'
        }`}
      >
        <span
          aria-hidden="true"
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            githubShellRunning ? 'bg-sage motion-safe:animate-pulse' : 'bg-navy-light/25'
          }`}
        />
        <Terminal size={13} strokeWidth={2} aria-hidden="true" className="shrink-0 text-sage" />
        <span className="text-[12px] font-semibold tracking-wide">Github</span>
      </button>

      {/* + start new session — chooser between a plain Shell and a Claude session */}
      <div className="border-b border-warm-gray/60">
        <button
          type="button"
          onClick={() => setChooserOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={chooserOpen}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setChooserOpen(false);
          }}
          className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-navy-light/70 hover:text-navy hover:bg-warm-gray/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage"
        >
          <Plus size={13} strokeWidth={2.5} className="shrink-0" /> start new session
        </button>
        {chooserOpen && (
          <div role="menu" className="px-2 pb-2 flex flex-col gap-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onStartShell)}
              className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-navy bg-warm-gray hover:bg-warm-gray/70 rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
            >
              <Terminal size={12} strokeWidth={2} className="text-sage" /> Shell
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onStartClaude)}
              className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-navy bg-warm-gray hover:bg-warm-gray/70 rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
            >
              <Plus size={12} strokeWidth={2.5} className="text-sage" /> Claude session
            </button>
          </div>
        )}
      </div>

      {grouped.size === 0 ? (
        <p className="px-3 py-4 text-[11px] text-navy-light/40 italic leading-relaxed">
          No repo sessions yet.
        </p>
      ) : (
        <div className="py-1 flex-1">
          {Array.from(grouped.entries()).map(([path, { repoName, items }]) => (
            <div key={path} className="mb-1">
              <div className="px-3 pt-2.5 pb-0.5 text-[10px] font-semibold text-sage uppercase tracking-wide truncate">
                {repoName}
              </div>
              {items.map((s) => {
                const label = s.title !== '' ? s.title : `${fmtDateTime(s.startedAt)} session`;
                const isActive = activeSessionId === s.id;
                return (
                  // Row is a container (NOT a button) so the delete button can
                  // be a sibling — no nested interactive elements.
                  <div
                    key={s.id}
                    className={`group flex items-center transition-colors ${
                      isActive ? 'bg-sage/20' : 'hover:bg-warm-gray/70'
                    }`}
                  >
                    <button
                      type="button"
                      data-session-select
                      onClick={() => onSelectSession(s.id)}
                      aria-label={`${label} — ${s.status === 'running' ? 'running' : 'ended'}`}
                      className={`flex-1 min-w-0 text-left pl-3 pr-1 py-1.5 flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage ${
                        isActive ? 'text-navy' : 'text-navy-light/60 group-hover:text-navy'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          s.status === 'running'
                            ? 'bg-sage motion-safe:animate-pulse'
                            : 'bg-navy-light/25'
                        }`}
                      />
                      {s.kind === 'shell' && (
                        <Terminal
                          size={11}
                          strokeWidth={2}
                          aria-hidden="true"
                          className="shrink-0 text-sage"
                        />
                      )}
                      <span className="flex-1 min-w-0 flex flex-col leading-tight">
                        <span className="block truncate text-[11px]">{label}</span>
                        <span className="block truncate text-[9px] text-navy-light/40 tabular-nums">
                          {fmtDateTime(s.startedAt)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSession(s)}
                      aria-label={`Delete session: ${label}`}
                      className="shrink-0 mr-1 grid place-items-center h-6 w-6 rounded text-terracotta opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-terracotta/15 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta transition-opacity cursor-pointer"
                    >
                      <Trash2 size={13} strokeWidth={2} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {deleteToast !== null && (
        <div
          role="status"
          aria-live="polite"
          className="sticky bottom-0 mx-2 mb-2 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-navy text-cream text-[11px] shadow-lg"
        >
          <span className="truncate">Session deleted</span>
          <button
            type="button"
            onClick={onUndoDelete}
            className="shrink-0 font-semibold text-sage hover:text-sage/80 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage rounded px-1"
          >
            Undo
          </button>
        </div>
      )}
    </nav>
  );
}
