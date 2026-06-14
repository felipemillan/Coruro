// EnrichmentBar.tsx — bottom progress bar shown while on-device AI enrichment runs.

import { Sparkles } from 'lucide-react';

interface EnrichmentBarProps {
  enrichProgress: { done: number; total: number } | null;
}

export function EnrichmentBar({ enrichProgress }: EnrichmentBarProps) {
  const widthPct =
    enrichProgress !== null && enrichProgress.total > 0
      ? `${(enrichProgress.done / enrichProgress.total) * 100}%`
      : '15%';

  return (
    <div className="shrink-0 border-t border-warm-gray bg-cream/80 px-4 py-2 flex items-center gap-3">
      <Sparkles size={13} strokeWidth={2} className="text-sage animate-pulse shrink-0" />
      <span className="text-[11px] text-navy-light shrink-0">
        Enriching context with on-device AI
        {enrichProgress !== null ? ` — ${enrichProgress.done}/${enrichProgress.total}` : '…'}
      </span>
      <div className="flex-1 h-1 rounded-full bg-navy/10 overflow-hidden">
        <div className="h-full bg-sage transition-all duration-300" style={{ width: widthPct }} />
      </div>
    </div>
  );
}
