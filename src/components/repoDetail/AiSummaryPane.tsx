// AiSummaryPane.tsx — on-device AI summary + tags for a repo.

import { Sparkles, RefreshCw } from 'lucide-react';

/** Compact relative age like "3d"/"5h"/"2w" from an ISO timestamp; '' when empty/bad. */
function relativeAge(iso: string): string {
  if (iso === '') return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.max(0, (Date.now() - then) / 1000);
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d`;
  if (sec < 2629800) return `${Math.floor(sec / 604800)}w`;
  return `${Math.floor(sec / 2629800)}mo`;
}

interface AiSummaryPaneProps {
  summary: string | undefined;
  tags: string[];
  model: string | null;
  analyzedAt: string | null;
  analyzing: boolean;
  unavailableReason: string | null;
  onReanalyze: () => void;
}

export function AiSummaryPane({
  summary,
  tags,
  model,
  analyzedAt,
  analyzing,
  unavailableReason,
  onReanalyze,
}: AiSummaryPaneProps) {
  return (
    <div className="p-6 max-w-[820px]">
      {analyzing ? (
        <p className="flex items-center gap-2 text-[13px] text-navy-light">
          <Sparkles size={14} strokeWidth={1.75} className="text-sage animate-pulse" />
          Analyzing on-device…
        </p>
      ) : summary ? (
        <div className="flex flex-col gap-4">
          <p className="text-[15px] leading-relaxed text-navy">{summary}</p>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 bg-sage/15 text-sage text-[11px] font-mono rounded-full"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 text-[11px] text-navy-light/50 pt-1">
            {model && <span className="font-mono">{model}</span>}
            {analyzedAt && relativeAge(analyzedAt) && (
              <span title={analyzedAt}>analyzed {relativeAge(analyzedAt)} ago</span>
            )}
            <button
              type="button"
              onClick={onReanalyze}
              className="flex items-center gap-1 text-navy-light hover:text-navy transition-colors cursor-pointer"
            >
              <RefreshCw size={11} strokeWidth={1.5} /> Re-analyze
            </button>
          </div>
        </div>
      ) : unavailableReason ? (
        <p className="text-[13px] text-navy-light/60 italic">
          Apple Intelligence unavailable ({unavailableReason}). On-device summaries are skipped on
          this machine.
        </p>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-[13px] text-navy-light/50 italic">No AI summary yet for this repo.</p>
          <button
            type="button"
            onClick={onReanalyze}
            className="flex items-center gap-1.5 text-[12px] font-medium text-cream bg-navy px-3 py-1.5 hover:bg-navy-light transition-colors cursor-pointer rounded-full"
          >
            <Sparkles size={13} strokeWidth={1.75} /> Analyze now
          </button>
        </div>
      )}
    </div>
  );
}
