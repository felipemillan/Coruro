// CommandCenterHeader.tsx — top action bar for the Command Center tab.

import { RefreshCw } from 'lucide-react';
import type { ElementType } from 'react';

interface QuickAction {
  label: string;
  short: string;
  icon: ElementType;
  run: () => void;
}

interface CommandCenterHeaderProps {
  scanning: boolean;
  inventoryLoaded: boolean;
  quickActions: QuickAction[];
  onRefresh: () => void;
}

export function CommandCenterHeader({
  scanning,
  inventoryLoaded,
  quickActions,
  onRefresh,
}: CommandCenterHeaderProps) {
  return (
    <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-warm-gray bg-cream/60">
      <h2 className="text-sm font-semibold text-navy">Command Center</h2>
      <div className="flex items-center gap-2">
        {scanning && (
          <span className="text-[11px] text-navy-light animate-pulse">Scanning&hellip;</span>
        )}
        <div className="flex items-center gap-1">
          {quickActions.map((qa) => (
            <button
              key={qa.label}
              type="button"
              title={qa.label}
              aria-label={qa.label}
              onClick={qa.run}
              disabled={!inventoryLoaded}
              className="nb-btn flex items-center gap-1 px-2 py-1 text-navy-light
                         hover:bg-cream hover:text-navy disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors cursor-pointer"
            >
              <qa.icon size={13} strokeWidth={1.75} />
              <span className="text-[11px] font-medium leading-none">{qa.short}</span>
            </button>
          ))}
        </div>
        <div className="h-5 w-px bg-warm-gray mx-0.5" aria-hidden="true" />
        <button
          type="button"
          title="Re-scan ~/.claude"
          onClick={onRefresh}
          disabled={scanning}
          className="nb-btn flex items-center gap-1.5 px-3 py-1.5 text-xs text-navy
                     hover:bg-cream/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <RefreshCw size={12} strokeWidth={2} />
          Refresh
        </button>
      </div>
    </div>
  );
}
