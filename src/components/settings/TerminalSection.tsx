// Terminal section for the Settings modal.
// Persists the macOS app name used for "open in terminal" on each card.
// Local transient state is seeded from the store on mount — the modal
// unmounts fully on close, so no sync-in-effect is needed.

import { useState } from 'react';
import { TerminalSquare, Volume2, Eye } from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';
import { SectionHeading } from './SectionHeading';

export function TerminalSection() {
  const terminalApp = useBoardStore((s) => s.settings.terminalApp);
  const setTerminalApp = useBoardStore((s) => s.setTerminalApp);
  const bellAudioEnabled = useBoardStore((s) => s.settings.bellAudioEnabled);
  const setBellAudioEnabled = useBoardStore((s) => s.setBellAudioEnabled);
  const bellVisualEnabled = useBoardStore((s) => s.settings.bellVisualEnabled);
  const setBellVisualEnabled = useBoardStore((s) => s.setBellVisualEnabled);

  const [terminalAppInput, setTerminalAppInput] = useState(terminalApp);

  return (
    <section>
      <SectionHeading>Terminal</SectionHeading>
      <p className="text-[12px] text-navy-light mb-3 leading-relaxed">
        The &quot;open in terminal&quot; button on each card launches this macOS app rooted at the
        repo (<code className="font-mono text-[11px] bg-warm-gray px-1 py-0.5">open -a</code>).
      </p>

      <label className="block text-[11px] text-navy-light mb-1">macOS app name</label>
      <div className="relative">
        <TerminalSquare
          size={13}
          strokeWidth={1.5}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-light/40 pointer-events-none"
        />
        <input
          type="text"
          value={terminalAppInput}
          onChange={(e) => setTerminalAppInput(e.target.value)}
          onBlur={() => {
            if (terminalAppInput !== terminalApp) void setTerminalApp(terminalAppInput.trim());
          }}
          placeholder="Terminal"
          spellCheck={false}
          autoComplete="off"
          className="nb-input w-full pl-8 pr-3 py-2 text-[12px] font-mono text-navy placeholder:text-navy-light/40 transition-colors duration-150"
        />
      </div>
      <p className="mt-2 text-[11px] text-navy-light/60 leading-snug">
        Examples: <span className="font-mono">Terminal</span>,{' '}
        <span className="font-mono">iTerm</span>, <span className="font-mono">Ghostty</span>,{' '}
        <span className="font-mono">Warp</span>.
      </p>

      {/* ── Code-tab bell notifications ─────────────────────────── */}
      <div className="border-t border-warm-gray my-4" />
      <label className="block text-[11px] text-navy-light mb-2 leading-snug">
        Code-tab terminal bell — Claude Code rings it on task-done.
      </label>

      <button
        type="button"
        onClick={() => void setBellAudioEnabled(!bellAudioEnabled)}
        className="nb-btn flex items-center justify-between w-full px-3 py-2 mb-2 bg-warm-gray/60 hover:bg-warm-gray text-[12px] text-navy transition-colors duration-150 cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <Volume2 size={13} strokeWidth={1.5} className="text-navy-light" />
          Audio beep
        </span>
        <span
          className={`
            px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full
            ${bellAudioEnabled ? 'bg-sage text-cream' : 'bg-navy/10 text-navy-light'}
          `}
        >
          {bellAudioEnabled ? 'On' : 'Off'}
        </span>
      </button>

      <button
        type="button"
        onClick={() => void setBellVisualEnabled(!bellVisualEnabled)}
        className="nb-btn flex items-center justify-between w-full px-3 py-2 bg-warm-gray/60 hover:bg-warm-gray text-[12px] text-navy transition-colors duration-150 cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <Eye size={13} strokeWidth={1.5} className="text-navy-light" />
          Visual flash
        </span>
        <span
          className={`
            px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full
            ${bellVisualEnabled ? 'bg-sage text-cream' : 'bg-navy/10 text-navy-light'}
          `}
        >
          {bellVisualEnabled ? 'On' : 'Off'}
        </span>
      </button>
    </section>
  );
}
