// App — root shell for MyGITdash.
//
// Responsibilities:
//  1. Call store.load() on mount; show a minimal loader while !loaded.
//  2. Render <Setup> when settings.rootDirectory is null (first run).
//  3. Render <Board> once a root is configured.
//  4. Top bar: symmetrical, translucent (backdrop-blur-md + bg-cream/80),
//     app name centred, gear icon right-aligned (opens <Settings>).
//  5. <Settings> owns its own open/closed toggle and renders the gear icon
//     trigger — App just places it in the top bar.

import { useEffect } from 'react';
import { X } from 'lucide-react';
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

  useEffect(() => {
    void load();
  }, [load]);

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
      {/* ── Top bar ───────────────────────────────────────────── */}
      <header
        className="
          sticky top-0 z-40
          h-10 px-4
          flex items-center justify-between
          backdrop-blur-md bg-cream/80
          border-b border-warm-gray
        "
      >
        {/* Left spacer — mirrors the gear button width for symmetry */}
        <div className="w-8" aria-hidden="true" />

        {/* App name — centred */}
        <span className="text-navy font-semibold text-sm tracking-wide select-none">
          MyGITdash
        </span>

        {/* Settings gear — self-contained, renders its own trigger button */}
        <Settings />
      </header>

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
    </div>
  );
}
