// App — root shell for MyGITdash.
//
// Responsibilities:
//  1. Call store.load() on mount; show a minimal loader while !loaded.
//  2. Render <Setup> when settings.rootDirectory is null (first run).
//  3. Render <Board> once a root is configured.
//  4. No top header bar. Settings open via the ⌘, shortcut or a small
//     floating gear button pinned bottom-right. App owns the open state and
//     passes it to the controlled <Settings> modal.
//  5. An optional debug strip renders at the very top when enabled.

import { useEffect, useState } from 'react';
import { X, Settings as SettingsIcon } from 'lucide-react';
import { useBoardStore } from './store/useBoardStore';
import { Setup } from './components/Setup';
import { Board } from './components/Board';
import { Settings } from './components/Settings';

export default function App() {
  const load = useBoardStore((s) => s.load);
  const loaded = useBoardStore((s) => s.loaded);
  const rootDirectory = useBoardStore((s) => s.settings.rootDirectory);
  const debugBannerEnabled = useBoardStore((s) => s.settings.debugBannerEnabled);
  const scanAndDistribute = useBoardStore((s) => s.scanAndDistribute);
  const setDebugBannerEnabled = useBoardStore((s) => s.setDebugBannerEnabled);
  const lastScanError = useBoardStore((s) => s.lastScanError);
  const repoCount = useBoardStore((s) => s.repos.length);

  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  // Global ⌘, (and Ctrl+,) toggles Settings — the macOS-standard shortcut.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // After load completes, populate the runtime repo list so the Board renders.
  // scanAndDistribute is idempotent: repos already in a column keep their
  // position; only new paths are appended to inbox. It records any failure on
  // store.lastScanError rather than throwing.
  useEffect(() => {
    if (loaded && rootDirectory !== null) {
      void scanAndDistribute(rootDirectory);
    }
  }, [loaded, rootDirectory, scanAndDistribute]);

  return (
    <div className="flex flex-col min-h-screen bg-cream text-navy">
      {/* Banner. Priority:
          1. Scan error — always shown (blocking), cannot be dismissed.
          2. Debug info — shown only while debugBannerEnabled; dismissible
             ("Don't show again" flips the persisted flag). Re-enable from
             Settings → Debug. */}
      {lastScanError !== null ? (
        <div className="px-4 py-1.5 text-[11px] font-mono bg-terracotta/15 text-terracotta border-b border-terracotta/40">
          Scan failed: {lastScanError}
        </div>
      ) : debugBannerEnabled ? (
        <div className="flex items-center justify-between px-4 py-1 text-[11px] font-mono bg-sage/10 text-navy-light border-b border-warm-gray">
          <span>
            repos: {repoCount} · root: {rootDirectory ?? 'null'}
          </span>
          <button
            type="button"
            onClick={() => void setDebugBannerEnabled(false)}
            aria-label="Hide debug banner"
            title="Don't show again (re-enable in Settings → Debug)"
            className="flex items-center gap-1 px-1.5 py-0.5 text-navy-light hover:text-navy hover:bg-warm-gray transition-colors cursor-pointer"
          >
            <X size={11} strokeWidth={1.5} />
            Hide
          </button>
        </div>
      ) : null}

      {/* ── Main content ──────────────────────────────────────── */}
      <main className="flex flex-col flex-1">
        {!loaded ? (
          /* Loader — shown only until store.load() resolves */
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sage text-sm animate-pulse">Loading&hellip;</span>
          </div>
        ) : rootDirectory === null ? (
          /* First-run: no root directory set */
          <Setup />
        ) : (
          /* Normal: board */
          <Board />
        )}
      </main>

      {/* Floating settings gear — bottom-right. Also openable via ⌘, */}
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        aria-label="Open settings"
        title="Settings (⌘,)"
        className="
          fixed bottom-4 right-4 z-40
          flex items-center justify-center
          w-10 h-10
          bg-cream/90 backdrop-blur-md
          border border-warm-gray shadow-sm
          text-navy-light hover:text-navy hover:bg-warm-gray
          transition-colors duration-150
          cursor-pointer
        "
      >
        <SettingsIcon size={18} strokeWidth={1.5} />
      </button>

      {/* Controlled settings modal */}
      <Settings isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
