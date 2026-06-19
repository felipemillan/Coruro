// Debug section for the Settings modal.
// Shows a live readout of root, repo count, and last scan status,
// a debug-banner toggle, and a rescan button.

import { useCallback, useState } from 'react';
import { Bug, RefreshCw } from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';
import { SectionHeading } from './SectionHeading';

export function DebugSection() {
  const rootDirectory = useBoardStore((s) => s.settings.rootDirectory);
  const repoCount = useBoardStore((s) => s.repos.length);
  const lastScanError = useBoardStore((s) => s.lastScanError);
  const debugBannerEnabled = useBoardStore((s) => s.settings.debugBannerEnabled);
  const setDebugBannerEnabled = useBoardStore((s) => s.setDebugBannerEnabled);
  const scanAndDistribute = useBoardStore((s) => s.scanAndDistribute);

  const [rescanning, setRescanning] = useState(false);

  const handleRescan = useCallback(async () => {
    if (rescanning || rootDirectory === null) return;
    setRescanning(true);
    try {
      await scanAndDistribute(rootDirectory);
    } finally {
      setRescanning(false);
    }
  }, [rescanning, rootDirectory, scanAndDistribute]);

  return (
    <section>
      <SectionHeading>Debug</SectionHeading>

      {/* Live readout */}
      <div className="nb-card-sm px-3 py-2 mb-3 text-[11px] font-mono text-navy-light flex flex-col gap-1">
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
          <span
            className={`text-right ${lastScanError !== null ? 'text-terracotta' : 'text-sage'}`}
          >
            {lastScanError !== null ? lastScanError : 'ok'}
          </span>
        </div>
      </div>

      {/* Banner toggle */}
      <button
        type="button"
        onClick={() => void setDebugBannerEnabled(!debugBannerEnabled)}
        className="nb-btn flex items-center justify-between w-full px-3 py-2 mb-3 bg-warm-gray/60 hover:bg-warm-gray text-[12px] text-navy transition-colors duration-150 cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <Bug size={13} strokeWidth={1.5} className="text-navy-light" />
          Show debug banner in top bar
        </span>
        <span
          className={`
            px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide
            rounded-full
            ${debugBannerEnabled ? 'bg-sage text-cream' : 'bg-navy/10 text-navy-light'}
          `}
        >
          {debugBannerEnabled ? 'On' : 'Off'}
        </span>
      </button>

      {/* Rescan */}
      <button
        type="button"
        onClick={() => void handleRescan()}
        disabled={rescanning || rootDirectory === null}
        className="nb-btn flex items-center gap-2 px-4 py-2 bg-navy text-cream text-[12px] font-medium hover:bg-navy-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer"
      >
        <RefreshCw size={13} strokeWidth={1.5} className={rescanning ? 'animate-spin' : ''} />
        {rescanning ? 'Rescanning…' : 'Rescan now'}
      </button>
    </section>
  );
}
