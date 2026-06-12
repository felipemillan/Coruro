import { useRef, useState } from 'react';
import type { Repo } from '../types';

interface NoteEditorProps {
  /** Prefilled body when editing an existing note; empty for the composer. */
  initialBody?: string;
  /** Repo list used for @mention autocomplete. */
  repos: Repo[];
  onSave: (body: string) => void;
  onCancel: () => void;
  saveLabel?: string;
  placeholder?: string;
}

interface MentionState {
  /** Index in the textarea value where the '@' of the active partial starts. */
  start: number;
  /** The partial repo name typed after '@' (may be empty). */
  partial: string;
  /** Highlighted item in the dropdown. */
  index: number;
}

/**
 * Reusable markdown editor with lightweight @mention autocomplete.
 *
 * While typing, if the text immediately before the caret matches /@([a-zA-Z0-9_-]*)$/,
 * a dropdown of up to 6 repos whose name starts with the partial (case-insensitive)
 * appears. Enter/click inserts '@name ' replacing the partial; Escape closes;
 * ArrowUp/Down navigate.
 */
export function NoteEditor({
  initialBody = '',
  repos,
  onSave,
  onCancel,
  saveLabel = 'Save',
  placeholder = 'Write a note… use @repo to mention a repository.',
}: NoteEditorProps) {
  const [body, setBody] = useState(initialBody);
  const [mention, setMention] = useState<MentionState | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const matches = mention
    ? repos
        .filter((r) => r.name.toLowerCase().startsWith(mention.partial.toLowerCase()))
        .slice(0, 6)
    : [];
  const dropdownOpen = mention !== null && matches.length > 0;

  const saveDisabled = body.trim() === '' || body === initialBody;

  /** Re-derive the active @mention partial from the caret position. */
  const refreshMention = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = before.match(/@([a-zA-Z0-9_-]*)$/);
    if (m) {
      setMention((prev) => ({
        start: caret - m[0].length,
        partial: m[1],
        // Keep the highlighted row when the partial only grows; reset otherwise.
        index: prev && prev.start === caret - m[0].length ? prev.index : 0,
      }));
    } else {
      setMention(null);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBody(e.target.value);
    refreshMention(e.target.value, e.target.selectionStart);
  };

  const insertMention = (repoName: string) => {
    if (!mention) return;
    const caret = textareaRef.current?.selectionStart ?? mention.start + 1 + mention.partial.length;
    const inserted = '@' + repoName + ' ';
    const next = body.slice(0, mention.start) + inserted + body.slice(caret);
    setBody(next);
    setMention(null);
    // Restore focus + caret just after the inserted mention.
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const pos = mention.start + inserted.length;
        ta.setSelectionRange(pos, pos);
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Escape is handled unconditionally: close the dropdown if open, otherwise
    // cancel the editor — keyboard-only users must never be trapped.
    if (e.key === 'Escape') {
      e.preventDefault();
      if (dropdownOpen) {
        setMention(null);
      } else {
        onCancel();
      }
      return;
    }
    // The remaining keys (ArrowUp/Down/Enter) only make sense when the dropdown
    // is open and there is an active mention partial.
    if (!dropdownOpen || !mention) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMention({ ...mention, index: (mention.index + 1) % matches.length });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMention({ ...mention, index: (mention.index - 1 + matches.length) % matches.length });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      insertMention(matches[Math.min(mention.index, matches.length - 1)].name);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          // Re-check the mention partial when the caret moves without typing.
          onClick={(e) => refreshMention(body, e.currentTarget.selectionStart)}
          onBlur={() => {
            // Delay so a dropdown click registers before the menu unmounts.
            setTimeout(() => setMention(null), 150);
          }}
          placeholder={placeholder}
          className="w-full min-h-[120px] rounded-xl border border-warm-gray bg-cream px-3 py-2
                     font-mono text-sm text-navy leading-relaxed resize-y
                     focus:outline-none focus:ring-1 focus:ring-navy"
        />

        {/* @mention autocomplete dropdown — anchored just below the textarea */}
        {dropdownOpen && (
          <div
            className="absolute left-3 top-full mt-1 z-20 w-56 rounded-xl border border-warm-gray
                       bg-cream shadow-md overflow-hidden"
          >
            {matches.map((repo, i) => (
              <button
                key={repo.path}
                type="button"
                // onMouseDown beats the textarea blur, so the click always lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(repo.name);
                }}
                className={[
                  'block w-full text-left px-3 py-1.5 text-sm cursor-pointer transition-colors',
                  i === Math.min(mention!.index, matches.length - 1)
                    ? 'bg-navy/10 text-navy'
                    : 'text-navy/80 hover:bg-navy/5',
                ].join(' ')}
              >
                @{repo.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-xl text-sm text-navy-light hover:text-navy
                     transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(body)}
          disabled={saveDisabled}
          className="px-4 py-1.5 rounded-xl bg-navy text-cream text-sm font-medium
                     disabled:opacity-50 disabled:cursor-not-allowed
                     hover:bg-navy/90 transition-colors cursor-pointer"
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
