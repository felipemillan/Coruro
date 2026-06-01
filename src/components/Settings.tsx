// Settings modal for MyGITdash.
//
// Self-contained: owns its own open/closed toggle via a gear icon trigger.
// Renders a backdrop-blur-md overlay with a cream/warm-gray panel.
// Zero border-radius throughout (global CSS contract handles it).
//
// Two control surfaces:
//   1. Root directory — native Tauri folder-picker dialog via @tauri-apps/plugin-dialog;
//      on confirm calls store.setRootDirectory(). Displays current path or "Not set".
//   2. GitHub PAT — password input + "Save token" button -> store.storeToken().
//      Reflects current hasToken state with a status badge.
//
// The raw token is never held in component state beyond the controlled input lifetime.
// On submit the input is cleared immediately and the token is sent to the Keychain.

import { useState, useCallback, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Settings as SettingsIcon,
  X,
  FolderOpen,
  KeyRound,
  CheckCircle2,
  Circle,
  Bug,
  RefreshCw,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useBoardStore } from '../store/useBoardStore';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-widest text-navy-light mb-3 select-none">
      {children}
    </h3>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Settings() {
  const rootDirectory = useBoardStore((s) => s.settings.rootDirectory);
  const hasToken = useBoardStore((s) => s.settings.hasToken);
  const setRootDirectory = useBoardStore((s) => s.setRootDirectory);
  const scanAndDistribute = useBoardStore((s) => s.scanAndDistribute);
  const storeToken = useBoardStore((s) => s.storeToken);
  const debugBannerEnabled = useBoardStore((s) => s.settings.debugBannerEnabled);
  const setDebugBannerEnabled = useBoardStore((s) => s.setDebugBannerEnabled);
  const lastScanError = useBoardStore((s) => s.lastScanError);
  const repoCount = useBoardStore((s) => s.repos.length);
  const editorCommand = useBoardStore((s) => s.settings.editorCommand);
  const editorApp = useBoardStore((s) => s.settings.editorApp);
  const setEditorCommand = useBoardStore((s) => s.setEditorCommand);
  const setEditorApp = useBoardStore((s) => s.setEditorApp);

  const [isOpen, setIsOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [dirPicking, setDirPicking] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [editorCmdInput, setEditorCmdInput] = useState('');
  const [editorAppInput, setEditorAppInput] = useState('');

  // ---- Handlers ------------------------------------------------------------

  const handleOpenModal = useCallback(() => {
    setIsOpen(true);
    setTokenInput('');
    setTokenError(null);
    // Seed editor inputs from the persisted settings on open.
    setEditorCmdInput(editorCommand);
    setEditorAppInput(editorApp);
  }, [editorCommand, editorApp]);

  const handleCloseModal = useCallback(() => {
    setIsOpen(false);
    setTokenInput('');
    setTokenError(null);
  }, []);

  const handlePickDirectory = useCallback(async () => {
    if (dirPicking) return;
    setDirPicking(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select root directory for repos',
      });
      if (typeof selected === 'string' && selected.length > 0) {
        await setRootDirectory(selected);
        await scanAndDistribute(selected);
      }
    } catch {
      // User dismissed the dialog or dialog failed — no-op.
    } finally {
      setDirPicking(false);
    }
  }, [dirPicking, setRootDirectory, scanAndDistribute]);

  const handleRescan = useCallback(async () => {
    if (rescanning || rootDirectory === null) return;
    setRescanning(true);
    try {
      await scanAndDistribute(rootDirectory);
    } finally {
      setRescanning(false);
    }
  }, [rescanning, rootDirectory, scanAndDistribute]);

  const handleSaveToken = useCallback(async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setTokenError('Token cannot be empty.');
      return;
    }
    setTokenSaving(true);
    setTokenError(null);
    try {
      await storeToken(trimmed);
      setTokenInput('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTokenError(`Failed to save token: ${msg}`);
    } finally {
      setTokenSaving(false);
    }
  }, [tokenInput, storeToken]);

  const handleTokenKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        void handleSaveToken();
      }
    },
    [handleSaveToken],
  );

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only close when clicking the overlay itself, not the panel.
      if (e.target === e.currentTarget) handleCloseModal();
    },
    [handleCloseModal],
  );

  // ---- Render --------------------------------------------------------------

  return (
    <>
      {/* Gear toggle button — rendered wherever Settings is placed in the tree */}
      <button
        type="button"
        onClick={handleOpenModal}
        aria-label="Open settings"
        className="
          flex items-center justify-center
          w-8 h-8
          text-navy-light
          hover:text-navy hover:bg-warm-gray
          transition-colors duration-150
          cursor-pointer
        "
      >
        <SettingsIcon size={16} strokeWidth={1.5} />
      </button>

      {/* Modal — portalled to <body> so the header's backdrop-blur (a
          containing block for fixed children) cannot clip or cover it. */}
      {isOpen && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          className="
            fixed inset-0 z-50
            flex items-center justify-center
            backdrop-blur-md bg-navy/20
          "
          onClick={handleOverlayClick}
        >
          {/* Panel */}
          <div
            className="
              relative
              w-[480px] max-w-[calc(100vw-2rem)]
              bg-cream border border-warm-gray
              shadow-xl
              overflow-hidden
            "
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-6 py-4 bg-warm-gray border-b border-warm-gray/60">
              <div className="flex items-center gap-2">
                <SettingsIcon size={14} strokeWidth={1.5} className="text-navy-light" />
                <span className="text-[13px] font-semibold text-navy tracking-wide select-none">
                  Settings
                </span>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                aria-label="Close settings"
                className="
                  flex items-center justify-center
                  w-6 h-6
                  text-navy-light hover:text-navy hover:bg-navy/10
                  transition-colors duration-150
                  cursor-pointer
                "
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            </div>

            {/* Panel body */}
            <div className="px-6 py-5 flex flex-col gap-6">

              {/* ---- Section: Root directory ---- */}
              <section>
                <SectionHeading>Root directory</SectionHeading>
                <p className="text-[12px] text-navy-light mb-3 leading-relaxed">
                  The folder scanned for local Git repositories. Any subdirectory
                  with a{' '}
                  <code className="font-mono text-[11px] bg-warm-gray px-1 py-0.5">
                    .git
                  </code>{' '}
                  folder is picked up automatically.
                </p>

                {/* Current path display */}
                <div className="
                  flex items-center
                  px-3 py-2 mb-3
                  bg-warm-gray border border-warm-gray/80
                  text-[12px] font-mono text-navy-light
                  overflow-hidden
                ">
                  {rootDirectory !== null ? (
                    <span className="truncate select-all">{rootDirectory}</span>
                  ) : (
                    <span className="italic text-navy-light/50">Not set</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void handlePickDirectory()}
                  disabled={dirPicking}
                  className="
                    flex items-center gap-2
                    px-4 py-2
                    bg-navy text-cream
                    text-[12px] font-medium
                    hover:bg-navy-light
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-colors duration-150
                    cursor-pointer
                  "
                >
                  <FolderOpen size={13} strokeWidth={1.5} />
                  {dirPicking ? 'Picking…' : 'Choose folder'}
                </button>
              </section>

              {/* Divider */}
              <div className="border-t border-warm-gray" />

              {/* ---- Section: GitHub token ---- */}
              <section>
                <SectionHeading>GitHub personal access token</SectionHeading>
                <p className="text-[12px] text-navy-light mb-3 leading-relaxed">
                  Used to fetch open pull-request counts. Stored in the macOS
                  Keychain — never written to disk.
                </p>

                {/* Token status badge */}
                <div className="flex items-center gap-1.5 mb-3">
                  {hasToken ? (
                    <>
                      <CheckCircle2 size={13} strokeWidth={1.5} className="text-sage" />
                      <span className="text-[12px] text-sage font-medium select-none">
                        Token saved
                      </span>
                    </>
                  ) : (
                    <>
                      <Circle size={13} strokeWidth={1.5} className="text-navy-light/40" />
                      <span className="text-[12px] text-navy-light/50 select-none">
                        No token set
                      </span>
                    </>
                  )}
                </div>

                {/* PAT input + save button */}
                <div className="flex items-stretch gap-2">
                  <div className="relative flex-1">
                    <KeyRound
                      size={13}
                      strokeWidth={1.5}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-light/40 pointer-events-none"
                    />
                    <input
                      type="password"
                      value={tokenInput}
                      onChange={(e) => {
                        setTokenInput(e.target.value);
                        if (tokenError !== null) setTokenError(null);
                      }}
                      onKeyDown={handleTokenKeyDown}
                      placeholder={hasToken ? 'Replace existing token…' : 'ghp_…'}
                      disabled={tokenSaving}
                      autoComplete="off"
                      spellCheck={false}
                      className="
                        w-full pl-8 pr-3 py-2
                        bg-warm-gray border border-warm-gray/80
                        text-[12px] font-mono text-navy
                        placeholder:text-navy-light/40
                        focus:outline-none focus:border-navy/40 focus:bg-cream
                        disabled:opacity-50 disabled:cursor-not-allowed
                        transition-colors duration-150
                      "
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleSaveToken()}
                    disabled={tokenSaving || tokenInput.trim().length === 0}
                    className="
                      px-4 py-2
                      bg-sage text-cream
                      text-[12px] font-medium
                      hover:bg-sage-light hover:text-navy
                      disabled:opacity-40 disabled:cursor-not-allowed
                      transition-colors duration-150
                      cursor-pointer
                      whitespace-nowrap
                    "
                  >
                    {tokenSaving ? 'Saving…' : 'Save token'}
                  </button>
                </div>

                {/* Inline error message */}
                {tokenError !== null && (
                  <p className="mt-2 text-[11px] text-terracotta leading-snug">
                    {tokenError}
                  </p>
                )}
              </section>

              {/* Divider */}
              <div className="border-t border-warm-gray" />

              {/* ---- Section: Editor ---- */}
              <section>
                <SectionHeading>Editor</SectionHeading>
                <p className="text-[12px] text-navy-light mb-3 leading-relaxed">
                  The “open in editor” button tries the CLI command first, then
                  falls back to launching the macOS app by name
                  (<code className="font-mono text-[11px] bg-warm-gray px-1 py-0.5">open -a</code>).
                  Leave the CLI blank to always use the app.
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
                    bg-warm-gray border border-warm-gray/80
                    text-[12px] font-mono text-navy
                    placeholder:text-navy-light/40
                    focus:outline-none focus:border-navy/40 focus:bg-cream
                    transition-colors duration-150
                  "
                />
                <p className="mt-2 text-[11px] text-navy-light/60 leading-snug">
                  Examples — CLI: <span className="font-mono">code</span>,{' '}
                  <span className="font-mono">cursor</span>,{' '}
                  <span className="font-mono">antigravity</span> · App:{' '}
                  <span className="font-mono">Antigravity</span>,{' '}
                  <span className="font-mono">Cursor</span>.
                </p>
              </section>

              {/* Divider */}
              <div className="border-t border-warm-gray" />

              {/* ---- Section: Debug ---- */}
              <section>
                <SectionHeading>Debug</SectionHeading>

                {/* Live readout */}
                <div className="
                  px-3 py-2 mb-3
                  bg-warm-gray border border-warm-gray/80
                  text-[11px] font-mono text-navy-light
                  flex flex-col gap-1
                ">
                  <div className="flex justify-between gap-3">
                    <span className="text-navy-light/60">root</span>
                    <span className="truncate text-right">{rootDirectory ?? 'not set'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-navy-light/60">repos found</span>
                    <span className="text-right">{repoCount}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-navy-light/60">last scan</span>
                    <span className={`text-right ${lastScanError !== null ? 'text-terracotta' : 'text-sage'}`}>
                      {lastScanError !== null ? lastScanError : 'ok'}
                    </span>
                  </div>
                </div>

                {/* Banner toggle */}
                <button
                  type="button"
                  onClick={() => void setDebugBannerEnabled(!debugBannerEnabled)}
                  className="
                    flex items-center justify-between w-full
                    px-3 py-2 mb-3
                    bg-warm-gray/60 hover:bg-warm-gray border border-warm-gray/80
                    text-[12px] text-navy
                    transition-colors duration-150 cursor-pointer
                  "
                >
                  <span className="flex items-center gap-2">
                    <Bug size={13} strokeWidth={1.5} className="text-navy-light" />
                    Show debug banner in top bar
                  </span>
                  <span className={`
                    px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide
                    ${debugBannerEnabled ? 'bg-sage text-cream' : 'bg-navy/10 text-navy-light'}
                  `}>
                    {debugBannerEnabled ? 'On' : 'Off'}
                  </span>
                </button>

                {/* Rescan */}
                <button
                  type="button"
                  onClick={() => void handleRescan()}
                  disabled={rescanning || rootDirectory === null}
                  className="
                    flex items-center gap-2
                    px-4 py-2
                    bg-navy text-cream text-[12px] font-medium
                    hover:bg-navy-light
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-colors duration-150 cursor-pointer
                  "
                >
                  <RefreshCw size={13} strokeWidth={1.5} className={rescanning ? 'animate-spin' : ''} />
                  {rescanning ? 'Rescanning…' : 'Rescan now'}
                </button>
              </section>

            </div>

            {/* Panel footer */}
            <div className="
              px-6 py-3
              bg-warm-gray/50 border-t border-warm-gray/60
              flex justify-end
            ">
              <button
                type="button"
                onClick={handleCloseModal}
                className="
                  px-4 py-1.5
                  text-[12px] text-navy-light
                  hover:text-navy hover:bg-warm-gray
                  transition-colors duration-150
                  cursor-pointer
                "
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
