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
import { invoke } from '@tauri-apps/api/core';
import { useBoardStore } from './store/useBoardStore';
import { useViewStore } from './store/useViewStore';
import { applyView } from './utils/filterSort';
import { safeOpenUrl } from './utils/openUrl';
import { COLUMN_IDS, type Repo } from './types';
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
  const refreshIntervalMin = useBoardStore((s) => s.settings.refreshIntervalMin);
  const enrichGitHub = useBoardStore((s) => s.enrichGitHub);

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

  // Background auto-refresh of GitHub data on the configured interval.
  // 0 (or no root / not loaded) disables the timer; per-card refresh and
  // rescan still work regardless.
  useEffect(() => {
    if (!loaded || rootDirectory === null) return;
    if (!refreshIntervalMin || refreshIntervalMin <= 0) return;
    const id = setInterval(() => {
      void enrichGitHub();
    }, refreshIntervalMin * 60_000);
    return () => clearInterval(id);
  }, [loaded, rootDirectory, refreshIntervalMin, enrichGitHub]);

  // Board keyboard navigation. Reads fresh state via getState() inside the
  // handler so it never goes stale and needs no dependency array.
  useEffect(() => {
    // Flatten the currently-visible cards across columns, in board order, so
    // j/k step through exactly what the user sees (same transform as Board).
    const flatVisible = (): Repo[] => {
      const { board, repos } = useBoardStore.getState();
      const { search, filters, sort } = useViewStore.getState();
      const byPath = new Map(repos.map((r) => [r.path, r]));
      const out: Repo[] = [];
      for (const col of COLUMN_IDS) {
        const colRepos = board[col]
          .map((p) => byPath.get(p))
          .filter((r): r is Repo => r !== undefined);
        out.push(...applyView(colRepos, { search, filters, sort }));
      }
      return out;
    };

    const onKey = (e: globalThis.KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      const view = useViewStore.getState();

      // '/' focuses the search box.
      if (e.key === '/' && !typing) {
        e.preventDefault();
        document.getElementById('repo-search')?.focus();
        return;
      }

      // Escape: close modal → blur field → clear active view.
      if (e.key === 'Escape') {
        if (view.detailPath !== null) {
          view.setDetail(null);
          return;
        }
        if (typing) (document.activeElement as HTMLElement | null)?.blur();
        if (view.search !== '' || view.filters.size > 0 || view.sort !== 'manual') {
          view.resetView();
        }
        return;
      }

      // The rest are single-key shortcuts; never hijack typing or modifier combos.
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'j' || e.key === 'k') {
        const list = flatVisible();
        if (list.length === 0) return;
        e.preventDefault();
        const cur = list.findIndex((r) => r.path === view.selectedPath);
        const next =
          cur === -1
            ? e.key === 'j'
              ? 0
              : list.length - 1
            : e.key === 'j'
              ? Math.min(cur + 1, list.length - 1)
              : Math.max(cur - 1, 0);
        const path = list[next].path;
        view.setSelected(path);
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-path="${CSS.escape(path)}"]`)
            ?.scrollIntoView({ block: 'nearest' });
        });
        return;
      }

      // Action keys operate on the selected card.
      if (view.selectedPath === null) return;
      const { repos, settings } = useBoardStore.getState();
      const repo = repos.find((r) => r.path === view.selectedPath);
      if (repo === undefined) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        view.setDetail(repo.path);
      } else if (e.key === 'e') {
        void invoke('open_in_editor', {
          command: settings.editorCommand,
          app: settings.editorApp,
          path: repo.path,
        });
      } else if (e.key === 't') {
        void invoke('open_in_terminal', { app: settings.terminalApp, path: repo.path });
      } else if (e.key === 'o') {
        if (repo.gh?.htmlUrl) void safeOpenUrl(repo.gh.htmlUrl);
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
          w-10 h-10 rounded-full
          bg-cream/90 backdrop-blur-md
          border border-warm-gray shadow-md
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
