/**
 * Setup.tsx — First-run welcome view.
 *
 * Rendered when `settings.rootDirectory` is null (no root picked yet).
 * Presents a centered, symmetrical layout in the cream/navy palette.
 *
 * Flow:
 *   1. User clicks "Choose directory" button.
 *   2. Native directory picker opens via @tauri-apps/plugin-dialog.
 *   3. On selection: setRootDirectory(path) persists the choice.
 *   4. scanAndDistribute(path) scans the filesystem, updates the runtime
 *      repo list, and files new paths into board.inbox — all in one atomic
 *      store action that reads its own snapshot (no stale-index risk).
 *   5. Parent (App.tsx) re-renders Board because rootDirectory is now set.
 */

import React, { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, GitBranch } from 'lucide-react';
import { useBoardStore } from '../store/useBoardStore';

export function Setup(): React.JSX.Element {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setRootDirectory = useBoardStore((s) => s.setRootDirectory);
  const scanAndDistribute = useBoardStore((s) => s.scanAndDistribute);

  async function handleChooseDirectory(): Promise<void> {
    setError(null);

    // Open native directory picker — returns the selected path or null if the
    // user cancelled.
    const selected = await open({ directory: true, multiple: false });

    if (selected === null) return; // user cancelled
    // After the null guard above, `selected` is narrowed to string.

    setScanning(true);
    try {
      // 1. Persist the chosen root; save() is called inside setRootDirectory.
      await setRootDirectory(selected);

      // 2. Scan + distribute: scans the filesystem, updates the runtime repo
      //    list, and appends only not-yet-placed paths to board.inbox — all
      //    in one store action reading its own consistent snapshot.
      await scanAndDistribute(selected);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Scan failed — check permissions.';
      setError(message);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-cream px-8">
      {/* ------------------------------------------------------------------ */}
      {/* Logo / wordmark area                                                */}
      {/* ------------------------------------------------------------------ */}
      <div className="mb-10 flex flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-warm-gray shadow-sm">
          <GitBranch size={28} className="text-navy" strokeWidth={1.5} />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-navy">
          Git Dashboard
        </h1>

        <p className="max-w-xs text-sm leading-relaxed text-navy-light">
          Pick a directory that contains your local git repositories. The
          dashboard will scan one level deep and populate your board.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Action                                                              */}
      {/* ------------------------------------------------------------------ */}
      <button
        type="button"
        onClick={() => void handleChooseDirectory()}
        disabled={scanning}
        className={[
          'flex items-center gap-2 rounded-full bg-sage px-6 py-3',
          'text-sm font-medium text-cream transition-colors',
          scanning
            ? 'cursor-not-allowed opacity-50'
            : 'hover:bg-sage-light',
        ].join(' ')}
      >
        <FolderOpen size={16} strokeWidth={1.5} />
        {scanning ? 'Scanning…' : 'Choose directory'}
      </button>

      {/* ------------------------------------------------------------------ */}
      {/* Error state                                                          */}
      {/* ------------------------------------------------------------------ */}
      {error !== null && (
        <p className="mt-4 max-w-xs text-center text-xs text-terracotta">
          {error}
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Footer hint                                                         */}
      {/* ------------------------------------------------------------------ */}
      <p className="mt-12 text-xs text-navy-light opacity-60">
        You can change this later in Settings.
      </p>
    </div>
  );
}
