// AskSidebar — left nav panel: session list grouped by repo, with
// inline-delete undo toast. Extracted from AskTab.tsx for size.

import { Trash2 } from 'lucide-react';
import type { ChatSession } from '../../types';
import { fmtTime } from './askUtils';

interface AskSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  deleteToast: { id: string; label: string } | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (session: ChatSession) => void;
  onUndoDelete: () => void;
}

export function AskSidebar({
  sessions,
  activeSessionId,
  deleteToast,
  onSelectSession,
  onDeleteSession,
  onUndoDelete,
}: AskSidebarProps) {
  // Group sessions by repo — Map insertion order = newest repo first (sessions
  // are prepended on start, so first encounter of each repo is most recent).
  const grouped = sessions.reduce<Map<string, { repoName: string; items: ChatSession[] }>>(
    (acc, s) => {
      if (!acc.has(s.repoPath)) acc.set(s.repoPath, { repoName: s.repoName, items: [] });
      acc.get(s.repoPath)!.items.push(s);
      return acc;
    },
    new Map(),
  );

  return (
    <nav
      aria-label="Sessions"
      className="w-52 shrink-0 border-r border-warm-gray flex flex-col bg-cream/30 overflow-y-auto"
    >
      <div className="px-3 py-2.5 border-b border-warm-gray/60">
        <span className="text-[10px] font-semibold text-navy-light/50 uppercase tracking-widest">
          Sessions
        </span>
      </div>
      {sessions.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-navy-light/40 italic leading-relaxed">
          No sessions yet.
          <br />
          Pick a repo and tap New.
        </p>
      ) : (
        <div className="py-1 flex-1">
          {Array.from(grouped.entries()).map(([path, { repoName, items }]) => (
            <div key={path} className="mb-1">
              <div className="px-3 pt-2.5 pb-0.5 text-[10px] font-semibold text-sage uppercase tracking-wide truncate">
                {repoName}
              </div>
              {items.map((s) => {
                const label = s.title !== '' ? s.title : `${fmtTime(s.startedAt)} session`;
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
                      <span className="block flex-1 min-w-0 text-[11px] truncate leading-tight">
                        {label}
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
