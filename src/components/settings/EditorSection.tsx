// Editor section for the Settings modal.
// Persists CLI command and macOS app name via the board store.
// Local transient state is seeded from the store on mount — the modal
// unmounts fully on close, so no sync-in-effect is needed.

import { useState } from 'react';
import { useBoardStore } from '../../store/useBoardStore';
import { SectionHeading } from './SectionHeading';

export function EditorSection() {
  const editorCommand = useBoardStore((s) => s.settings.editorCommand);
  const editorApp = useBoardStore((s) => s.settings.editorApp);
  const setEditorCommand = useBoardStore((s) => s.setEditorCommand);
  const setEditorApp = useBoardStore((s) => s.setEditorApp);

  const [editorCmdInput, setEditorCmdInput] = useState(editorCommand);
  const [editorAppInput, setEditorAppInput] = useState(editorApp);

  return (
    <section>
      <SectionHeading>Editor</SectionHeading>
      <p className="text-[12px] text-navy-light mb-3 leading-relaxed">
        The &quot;open in editor&quot; button tries the CLI command first, then falls back to
        launching the macOS app by name (
        <code className="font-mono text-[11px] bg-warm-gray px-1 py-0.5">open -a</code>). Leave the
        CLI blank to always use the app.
      </p>

      <label className="block text-[11px] text-navy-light mb-1">CLI command</label>
      <input
        type="text"
        value={editorCmdInput}
        onChange={(e) => setEditorCmdInput(e.target.value)}
        onBlur={() => {
          if (editorCmdInput !== editorCommand) void setEditorCommand(editorCmdInput.trim());
        }}
        placeholder="code"
        spellCheck={false}
        autoComplete="off"
        className="
          w-full px-3 py-2 mb-3
          rounded-lg
          bg-warm-gray border border-warm-gray/80
          text-[12px] font-mono text-navy
          placeholder:text-navy-light/40
          focus:outline-none focus:border-navy/40 focus:bg-cream
          transition-colors duration-150
        "
      />

      <label className="block text-[11px] text-navy-light mb-1">macOS app name (fallback)</label>
      <input
        type="text"
        value={editorAppInput}
        onChange={(e) => setEditorAppInput(e.target.value)}
        onBlur={() => {
          if (editorAppInput !== editorApp) void setEditorApp(editorAppInput.trim());
        }}
        placeholder="Visual Studio Code"
        spellCheck={false}
        autoComplete="off"
        className="
          w-full px-3 py-2
          rounded-lg
          bg-warm-gray border border-warm-gray/80
          text-[12px] font-mono text-navy
          placeholder:text-navy-light/40
          focus:outline-none focus:border-navy/40 focus:bg-cream
          transition-colors duration-150
        "
      />
      <p className="mt-2 text-[11px] text-navy-light/60 leading-snug">
        Examples — CLI: <span className="font-mono">code</span>,{' '}
        <span className="font-mono">cursor</span>, <span className="font-mono">antigravity</span> ·
        App: <span className="font-mono">Antigravity</span>,{' '}
        <span className="font-mono">Cursor</span>.
      </p>
    </section>
  );
}
