/**
 * QuickCmdsDialog.tsx — portalled <dialog> for managing user-defined quick commands.
 *
 * Opened by the pencil button in TopActionBar's built-in chip strip. Renders a
 * compact list of existing user commands with delete, plus an add form (label +
 * text). Persists to localStorage key `coruro.quickcmds.user`.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, X } from 'lucide-react';

// ── Storage ───────────────────────────────────────────────────────────────────

export const USER_CMDS_KEY = 'coruro.quickcmds.user';

export interface UserCmd {
  label: string;
  text: string;
}

export function loadUserCmds(): UserCmd[] {
  try {
    const raw = localStorage.getItem(USER_CMDS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is UserCmd =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as UserCmd).label === 'string' &&
        typeof (c as UserCmd).text === 'string',
    );
  } catch {
    return [];
  }
}

export function saveUserCmds(cmds: UserCmd[]): void {
  try {
    localStorage.setItem(USER_CMDS_KEY, JSON.stringify(cmds));
  } catch {
    /* storage full / unavailable — best-effort */
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface QuickCmdsDialogProps {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose(): void;
  cmds: UserCmd[];
  onChange(cmds: UserCmd[]): void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function QuickCmdsDialog({ triggerRef, onClose, cmds, onChange }: QuickCmdsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');

  // Open the native dialog and focus first input.
  useEffect(() => {
    dialogRef.current?.showModal();
    firstInputRef.current?.focus();
  }, []);

  // Escape closes and returns focus to trigger.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      handleClose();
    };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  });

  function handleClose() {
    dialogRef.current?.close();
    onClose();
    triggerRef.current?.focus();
  }

  function handleAdd() {
    const trimLabel = label.trim();
    const trimText = text.trim();
    if (!trimLabel || !trimText) return;
    const next = [...cmds, { label: trimLabel, text: trimText }];
    saveUserCmds(next);
    onChange(next);
    setLabel('');
    setText('');
  }

  function handleDelete(idx: number) {
    const next = cmds.filter((_, i) => i !== idx);
    saveUserCmds(next);
    onChange(next);
  }

  const dialogId = 'quick-cmds-dialog-title';

  return createPortal(
    // Backdrop click closes
    <dialog
      ref={dialogRef}
      aria-labelledby={dialogId}
      onClick={(e) => {
        if (e.target === dialogRef.current) handleClose();
      }}
      className="
        m-auto p-0 rounded-xl border border-warm-gray bg-cream shadow-2xl
        backdrop:bg-navy/30 backdrop:backdrop-blur-sm
        open:flex open:flex-col
        w-[340px] max-h-[70vh]
        focus:outline-none
      "
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-warm-gray shrink-0">
        <h2 id={dialogId} className="text-[13px] font-semibold text-navy">
          Quick commands
        </h2>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close quick commands dialog"
          className="p-1 rounded-md hover:bg-warm-gray/70 text-navy-light/60 hover:text-navy transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      {/* Existing commands */}
      <div className="flex-1 overflow-y-auto px-4 py-2 min-h-0">
        {cmds.length === 0 ? (
          <p className="text-[11px] text-navy-light/40 italic py-3">
            No custom commands yet. Add one below.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {cmds.map((c, i) => (
              <li
                key={`${c.label}-${i}`}
                className="flex items-center gap-2 rounded-lg border border-warm-gray/70 bg-cream/40 px-2.5 py-1.5 group"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-navy truncate">{c.label}</div>
                  <div className="text-[10px] font-mono text-navy-light/45 truncate">{c.text}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(i)}
                  aria-label={`Delete command ${c.label}`}
                  className="shrink-0 p-1.5 rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-terracotta/10 text-navy-light/40 hover:text-terracotta transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
                >
                  <Trash2 size={12} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add form */}
      <div className="px-4 py-3 border-t border-warm-gray shrink-0 flex flex-col gap-2">
        <input
          ref={firstInputRef}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. /myfix)"
          className="w-full px-2.5 py-1.5 rounded-lg border border-warm-gray bg-cream text-[12px] text-navy placeholder:text-navy-light/40 focus:outline-none focus:ring-2 focus:ring-sage"
        />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
          placeholder="Command text (inserted verbatim)"
          className="w-full px-2.5 py-1.5 rounded-lg border border-warm-gray bg-cream text-[12px] font-mono text-navy placeholder:text-navy-light/40 focus:outline-none focus:ring-2 focus:ring-sage"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!label.trim() || !text.trim()}
          className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg bg-sage text-cream text-[12px] font-semibold hover:bg-sage/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
        >
          <Plus size={13} strokeWidth={2.5} />
          Add command
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
