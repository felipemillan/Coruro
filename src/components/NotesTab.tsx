import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useBoardStore } from '../store/useBoardStore';
import { useViewStore } from '../store/useViewStore';
import { NoteEditor } from './NoteEditor';
import type { Repo } from '../types';
import type { Components } from 'react-markdown';

/**
 * Pre-process AI-generated markdown before rendering:
 * - Strip empty list items (orphaned `•` bullets before headings)
 * - Collapse 3+ consecutive blank lines to 2
 */
function cleanMarkdown(body: string): string {
  return body
    .split('\n')
    .filter((line, i, lines) => {
      // Drop lines that are only `- `, `* `, or `+ ` (empty list item)
      if (/^\s*[-*+]\s*$/.test(line)) return false;
      // Collapse consecutive blank lines: keep only if previous non-blank wasn't also blank
      if (line.trim() === '') {
        const prev = lines.slice(0, i).reverse().find((l) => l.trim() !== '');
        return prev !== undefined;
      }
      return true;
    })
    .join('\n');
}

/** Build react-markdown custom components that turn @reponame into interactive chips. */
function makeComponents(repos: Repo[], onRepoClick: (repo: Repo) => void): Components {
  return {
    p({ children }) {
      return <p className="mb-2 last:mb-0 leading-relaxed text-navy/90">{injectMentions(children, repos, onRepoClick)}</p>;
    },
    li({ children }) {
      return <li className="mb-0.5 leading-snug">{injectMentions(children, repos, onRepoClick)}</li>;
    },
    // h1: card title — bold, full separator
    h1({ children }) {
      return <h1 className="text-base font-bold text-navy mt-4 mb-2 pb-1 border-b border-warm-gray/50 first:mt-0">{children}</h1>;
    },
    // h2: repo section — medium weight + bottom rule
    h2({ children }) {
      return <h2 className="text-sm font-semibold text-navy mt-4 mb-1.5 pb-0.5 border-b border-warm-gray/30 first:mt-0">{children}</h2>;
    },
    // h3: sub-section — sage left accent, small caps feel
    h3({ children }) {
      return <h3 className="text-xs font-semibold text-navy/70 mt-3 mb-1 pl-2 border-l-2 border-sage/60 first:mt-0">{children}</h3>;
    },
    ul({ children }) {
      return <ul className="list-disc list-outside ml-4 space-y-0.5 text-sm text-navy/85 mb-2">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="list-decimal list-outside ml-4 space-y-0.5 text-sm text-navy/85 mb-2">{children}</ol>;
    },
    code({ children }) {
      return <code className="font-mono text-xs bg-navy/6 border border-navy/10 px-1 py-0.5 rounded">{children}</code>;
    },
    strong({ children }) {
      return <strong className="font-semibold text-navy">{children}</strong>;
    },
    hr() {
      return <hr className="border-warm-gray/30 my-3" />;
    },
  };
}

function injectMentions(
  children: React.ReactNode,
  repos: Repo[],
  onRepoClick: (repo: Repo) => void
): React.ReactNode {
  if (typeof children !== 'string') return children;
  const parts = children.split(/(@[a-zA-Z0-9_/-]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const name = part.slice(1);
      const repo = repos.find((r) => r.name === name || r.path.endsWith('/' + name));
      if (repo) {
        return (
          <button
            key={i}
            onClick={() => onRepoClick(repo)}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                       bg-navy/10 text-navy hover:bg-navy/20 cursor-pointer mx-0.5 transition-colors"
          >
            @{name}
          </button>
        );
      }
      return <span key={i} className="font-mono text-warm-gray text-xs">{part}</span>;
    }
    return part;
  });
}

export function NotesTab() {
  const dayNotes = useBoardStore((s) => s.dayNotes);
  const generatingNotes = useBoardStore((s) => s.generatingNotes);
  const notesError = useBoardStore((s) => s.notesError);
  const generateDayNotes = useBoardStore((s) => s.generateDayNotes);
  const deleteDayNote = useBoardStore((s) => s.deleteDayNote);
  const addUserNote = useBoardStore((s) => s.addUserNote);
  const updateDayNote = useBoardStore((s) => s.updateDayNote);
  const clearNotesError = useBoardStore((s) => s.clearNotesError);
  const repos = useBoardStore((s) => s.repos);
  const autoNotesEnabled = useBoardStore((s) => s.settings.autoNotesEnabled);
  const autoNotesIntervalMin = useBoardStore((s) => s.settings.autoNotesIntervalMin);
  const setAutoNotesEnabled = useBoardStore((s) => s.setAutoNotesEnabled);
  const setAutoNotesIntervalMin = useBoardStore((s) => s.setAutoNotesIntervalMin);
  const setDetail = useViewStore((s) => s.setDetail);

  // Local state for the interval input so we can show inline validation without
  // touching the store on invalid keystrokes.
  const [intervalDraft, setIntervalDraft] = useState<string>(String(autoNotesIntervalMin));
  const [intervalError, setIntervalError] = useState<string | null>(null);

  // Composer expanded/collapsed state for the "Write a note" affordance.
  const [composing, setComposing] = useState(false);
  // Id of the note currently being edited inline — only one at a time.
  const [editingId, setEditingId] = useState<string | null>(null);

  const sorted = [...dayNotes.notes].reverse(); // newest first

  const handleRepoClick = (repo: Repo) => {
    setDetail(repo.path);
  };

  const handleIntervalChange = (raw: string) => {
    setIntervalDraft(raw);
    const parsed = parseInt(raw, 10);
    if (!raw || isNaN(parsed) || parsed <= 0) {
      setIntervalError('Enter a positive whole number of minutes.');
    } else {
      setIntervalError(null);
      setAutoNotesIntervalMin(parsed);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-4">
      {/* Header row — includes persistent loading indicator (Fix 6) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-navy">Day Notes</h2>
          {/* Fix 6: loading badge shown whenever generatingNotes is true,
              regardless of whether notes already exist. */}
          {generatingNotes && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-sage/20 text-sage font-medium animate-pulse">
              Updating…
            </span>
          )}
        </div>
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

      {/* Fix 5: Auto Notes settings row */}
      <div className="rounded-xl border border-warm-gray bg-cream/60 px-4 py-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-navy">Auto Notes</span>
          {/* Toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={autoNotesEnabled}
            onClick={() => setAutoNotesEnabled(!autoNotesEnabled)}
            className={[
              'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full',
              'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy',
              autoNotesEnabled ? 'bg-navy' : 'bg-warm-gray',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={[
                'pointer-events-none inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow',
                'transform transition-transform',
                autoNotesEnabled ? 'translate-x-4' : 'translate-x-0.5',
              ].join(' ')}
            />
          </button>
        </div>
        {/* Interval input — only meaningful when auto is enabled */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-navy-light" htmlFor="auto-notes-interval">
            Every
          </label>
          <input
            id="auto-notes-interval"
            type="number"
            min={1}
            step={1}
            value={intervalDraft}
            disabled={!autoNotesEnabled}
            onChange={(e) => handleIntervalChange(e.target.value)}
            className={[
              'w-16 rounded-lg border px-2 py-1 text-xs text-navy bg-cream',
              'focus:outline-none focus:ring-1 focus:ring-navy',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              intervalError ? 'border-red-400' : 'border-warm-gray',
            ].join(' ')}
          />
          <span className="text-xs text-navy-light">minutes</span>
        </div>
        {/* Inline validation error */}
        {intervalError && (
          <p className="text-xs text-red-600">{intervalError}</p>
        )}
      </div>

      {/* Composer: human-written notes (trigger 'user') */}
      {composing ? (
        <div className="rounded-xl border border-warm-gray bg-cream/60 px-4 py-3 flex flex-col gap-2">
          <span className="text-sm font-medium text-navy">Write a note</span>
          <NoteEditor
            repos={repos}
            onSave={(body) => {
              addUserNote(body);
              setComposing(false);
            }}
            onCancel={() => setComposing(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="rounded-xl border border-warm-gray bg-cream/60 px-4 py-3 text-left text-sm
                     text-navy-light hover:text-navy hover:bg-cream transition-colors cursor-pointer"
        >
          + Write a note
        </button>
      )}

      {/* Fix 7: Error banner with dismiss button */}
      {notesError && (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{notesError}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => clearNotesError()}
            className="flex-shrink-0 text-red-500 hover:text-red-700 transition-colors leading-none font-medium"
          >
            &times;
          </button>
        </div>
      )}

      {/* Empty state */}
      {sorted.length === 0 && !generatingNotes && !notesError && (
        <div className="flex-1 flex items-center justify-center text-navy-light text-sm">
          No notes yet. Click &ldquo;Generate Day Notes&rdquo; to start.
        </div>
      )}

      {/* Generating spinner — empty-state variant (no notes yet) */}
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
            {/* Fix 8: use undefined locale so the device locale is respected */}
            <span className="text-xs text-navy-light">
              {new Date(note.generatedAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {/* Subtle hint when the note body was edited after creation */}
            {note.editedAt && (
              <span className="text-xs text-navy-light/60 italic">(edited)</span>
            )}
            <span
              className={
                note.trigger === 'user'
                  ? 'px-2 py-0.5 rounded-full text-xs bg-terracotta/15 text-terracotta font-medium'
                  : note.trigger === 'auto'
                    ? 'px-2 py-0.5 rounded-full text-xs bg-sage/20 text-sage font-medium'
                    : 'px-2 py-0.5 rounded-full text-xs bg-navy/10 text-navy font-medium'
              }
            >
              {note.trigger}
            </span>
            <button
              type="button"
              aria-label="Edit note"
              title="Edit note"
              onClick={() => setEditingId(editingId === note.id ? null : note.id)}
              className="ml-auto flex-shrink-0 px-1.5 text-navy-light/60 hover:text-navy
                         transition-colors leading-none text-sm cursor-pointer"
            >
              &#9998;
            </button>
            <button
              type="button"
              aria-label="Delete note"
              title="Delete note"
              onClick={() => deleteDayNote(note.id)}
              className="flex-shrink-0 px-1.5 text-navy-light/60 hover:text-red-600
                         transition-colors leading-none text-base cursor-pointer"
            >
              &times;
            </button>
          </div>
          {editingId === note.id ? (
            <NoteEditor
              initialBody={note.body}
              repos={repos}
              onSave={(body) => {
                updateDayNote(note.id, body);
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div className="text-sm text-navy leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={makeComponents(repos, handleRepoClick)}
              >
                {cleanMarkdown(note.body)}
              </ReactMarkdown>
            </div>
          )}
          <span className="text-xs text-navy-light/70">{note.model}</span>
        </div>
      ))}
    </div>
  );
}
