// NotesTab.tsx — top-level Day Notes tab.
//
// Pulls dayNotes + generatingNotes from the board store and renders a
// chronological (newest-first) list of note cards with a manual-trigger button.

import { useBoardStore } from '../store/useBoardStore';
import { useViewStore } from '../store/useViewStore';
import type { Repo } from '../types';

/**
 * Parse note body for @reponame references and render as interactive chips.
 * Unmatched @ references render as plain text.
 */
function renderNoteBody(
  body: string,
  repos: Repo[],
  onRepoClick: (repo: Repo) => void
): React.ReactNode {
  const parts = body.split(/(@[a-zA-Z0-9_-]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const name = part.slice(1);
      const repo = repos.find((r) => r.name === name);
      if (repo) {
        return (
          <button
            key={i}
            onClick={() => onRepoClick(repo)}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                       bg-navy/10 text-navy hover:bg-navy/20 cursor-pointer mx-0.5
                       transition-colors"
          >
            @{name}
          </button>
        );
      }
      return (
        <span key={i} className="font-mono text-warm-gray text-xs">
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function NotesTab() {
  const dayNotes = useBoardStore((s) => s.dayNotes);
  const generatingNotes = useBoardStore((s) => s.generatingNotes);
  const notesError = useBoardStore((s) => s.notesError);
  const generateDayNotes = useBoardStore((s) => s.generateDayNotes);
  const repos = useBoardStore((s) => s.repos);
  const setDetail = useViewStore((s) => s.setDetail);

  const sorted = [...dayNotes.notes].reverse(); // newest first

  const handleRepoClick = (repo: Repo) => {
    setDetail(repo.path);
  };

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-navy">Day Notes</h2>
        <button
          type="button"
          onClick={() => void generateDayNotes('manual')}
          disabled={generatingNotes}
          className="px-4 py-2 rounded-xl bg-navy text-cream text-sm font-medium
                     disabled:opacity-50 disabled:cursor-not-allowed
                     hover:bg-navy/90 transition-colors cursor-pointer"
        >
          {generatingNotes ? 'Generating…' : 'Generate Day Notes'}
        </button>
      </div>

      {/* Error banner */}
      {notesError && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {notesError}
        </div>
      )}

      {/* Empty state */}
      {sorted.length === 0 && !generatingNotes && !notesError && (
        <div className="flex-1 flex items-center justify-center text-navy-light text-sm">
          No notes yet. Click &ldquo;Generate Day Notes&rdquo; to start.
        </div>
      )}

      {/* Generating spinner */}
      {generatingNotes && sorted.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-navy-light text-sm animate-pulse">
          Generating…
        </div>
      )}

      {/* Note cards */}
      {sorted.map((note) => (
        <div
          key={note.id}
          className="rounded-2xl border border-warm-gray bg-cream shadow-sm p-5 flex flex-col gap-2"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-navy-light">
              {new Date(note.generatedAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span
              className={
                note.trigger === 'auto'
                  ? 'px-2 py-0.5 rounded-full text-xs bg-sage/20 text-sage font-medium'
                  : 'px-2 py-0.5 rounded-full text-xs bg-navy/10 text-navy font-medium'
              }
            >
              {note.trigger}
            </span>
          </div>
          <div className="text-sm text-navy leading-relaxed whitespace-pre-wrap">
            {renderNoteBody(note.body, repos, handleRepoClick)}
          </div>
          <span className="text-xs text-navy-light/70">{note.model}</span>
        </div>
      ))}
    </div>
  );
}
