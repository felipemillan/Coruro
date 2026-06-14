// BranchesPanel.tsx — local branches strip with fetch button.

import { GitBranch, RefreshCw } from 'lucide-react';

interface BranchesPanelProps {
  branches: string[];
  currentBranch: string;
  fetching: boolean;
  fetchError: string | null;
  onFetch: () => void;
}

export function BranchesPanel({
  branches,
  currentBranch,
  fetching,
  fetchError,
  onFetch,
}: BranchesPanelProps) {
  return (
    <div className="shrink-0 px-5 py-2 bg-warm-gray border-b border-warm-gray/60 flex items-start gap-3 rounded-xl mx-2 mt-1.5 mb-0">
      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
        <GitBranch size={12} strokeWidth={1.5} className="text-navy-light/60" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-light/60 select-none">
          Branches
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
        {branches.length === 0 ? (
          <span className="text-[11px] text-navy-light/40 italic">—</span>
        ) : (
          branches.map((b) => {
            const isCurrent = b === currentBranch;
            return (
              // Branch pills — M3: rounded-full
              <span
                key={b}
                className={`flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-mono rounded-full ${
                  isCurrent ? 'bg-sage/20 text-navy font-semibold' : 'text-navy-light'
                }`}
              >
                {isCurrent && (
                  <GitBranch size={10} strokeWidth={1.5} className="text-sage shrink-0" />
                )}
                {b}
                {isCurrent && (
                  <span className="ml-0.5 text-[9px] uppercase tracking-wide text-sage/80 font-semibold">
                    current
                  </span>
                )}
              </span>
            );
          })
        )}
        {fetchError !== null && (
          <span className="text-[11px] text-terracotta font-mono ml-1">{fetchError}</span>
        )}
      </div>
      {/* Fetch button — M3: rounded-full filled/primary */}
      <button
        type="button"
        onClick={onFetch}
        disabled={fetching}
        aria-label="Fetch remote refs"
        title="Fetch remote refs"
        className="flex items-center gap-1 shrink-0 text-[11px] text-navy-light hover:text-navy disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer rounded-full px-2 py-0.5"
      >
        <RefreshCw size={12} strokeWidth={1.5} className={fetching ? 'animate-spin' : ''} />
        {fetching ? 'Fetching…' : 'Fetch'}
      </button>
    </div>
  );
}
