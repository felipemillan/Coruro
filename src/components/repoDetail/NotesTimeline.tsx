// NotesTimeline.tsx — chat-style notes panel backed by coruro_notes.json.

import { useRef, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { TYPE_LABEL } from '../../utils/notesTimeline';
import { NOTE_TYPES, type NotesTimeline as NotesTimelineType, type NoteType } from '../../types';

interface NotesTimelineProps {
  timeline: NotesTimelineType | null;
  timelineError: string | null;
  composerType: NoteType;
  composerBody: string;
  onComposerTypeChange: (t: NoteType) => void;
  onComposerBodyChange: (body: string) => void;
  onAddNote: () => void;
  onDeleteNote: (id: string) => void;
}

export function NotesTimeline({
  timeline,
  timelineError,
  composerType,
  composerBody,
  onComposerTypeChange,
  onComposerBodyChange,
  onAddNote,
  onDeleteNote,
}: NotesTimelineProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Scroll to newest note after timeline changes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [timeline]);

  return (
    <div className="h-[38%] shrink-0 flex flex-col min-h-0 bg-cream/40 border border-warm-gray rounded-xl overflow-hidden">
      <div className="shrink-0 px-5 py-2 flex items-center justify-between border-b border-warm-gray">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-light/60 select-none">
          Notes timeline
        </span>
        <span className="text-[10px] font-mono text-navy-light/40">coruro_notes.json</span>
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
            // Note card — M3: rounded-xl
            <div
              key={n.id}
              className="group bg-cream border border-navy/10 px-3 py-2 text-[13px] text-navy rounded-xl"
            >
              <div className="flex items-center justify-between mb-1">
                {/* Type-label chip — M3: rounded-full */}
                <span className="text-[10px] font-semibold uppercase tracking-wide text-sage px-1.5 py-0.5 bg-sage/10 rounded-full">
                  {TYPE_LABEL[n.type]}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-navy-light/40">
                    {n.createdAt.slice(0, 16).replace('T', ' ')}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDeleteNote(n.id)}
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
        {/* Note type selector — M3: rounded-lg */}
        <select
          value={composerType}
          onChange={(e) => onComposerTypeChange(e.target.value as NoteType)}
          aria-label="Note type"
          className="text-[12px] font-mono bg-cream border border-navy/10 px-2 py-1.5 focus:outline-none focus:border-sage/60 cursor-pointer rounded-lg"
        >
          {NOTE_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        {/* Note body textarea — M3: rounded-lg */}
        <textarea
          value={composerBody}
          onChange={(e) => onComposerBodyChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              onAddNote();
            }
          }}
          placeholder="New note… (⌘/Ctrl+Enter to add)"
          rows={2}
          className="flex-1 resize-none text-[13px] text-navy font-mono leading-relaxed bg-cream border border-navy/10 px-3 py-2 placeholder:text-navy/30 focus:outline-none focus:border-sage/60 transition-colors rounded-lg"
          aria-label="New note body"
        />
        {/* Add note button — M3: rounded-full filled/primary */}
        <button
          type="button"
          onClick={onAddNote}
          disabled={composerBody.trim() === ''}
          className="flex items-center gap-1 text-[12px] font-semibold text-cream bg-navy px-3 py-2 hover:bg-navy-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0 rounded-full"
        >
          <Plus size={13} strokeWidth={2} />
          New note
        </button>
      </div>
    </div>
  );
}
