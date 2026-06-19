// Recommendations.tsx — the "Curate" sub-tab of the Command Center.
//
// Renders deterministic curator findings (computed in TS, secret-free) grouped
// by recommendation category, plus an additive AI narrative banner. Each finding
// can be handed to a real Claude session via the Ask bridge ("Ask Claude to fix").
//
// The AI narrative is qualitative prose only; every number shown in a card comes
// from the deterministic finding, never from the model. Cards render even when
// Apple Intelligence is unavailable.

import { Sparkles, RefreshCw } from 'lucide-react';
import { homeDir, join } from '@tauri-apps/api/path';
import type { CurateFinding, CurateCategory } from '../../types';
import { useViewStore } from '../../store/useViewStore';
import { SectionHeader } from './markdownComponents';
import { MarkdownBody } from '../shared/MarkdownBody';

export interface RecommendationsProps {
  findings: CurateFinding[] | null;
  narrative: string | null;
  loading: boolean;
  unavailableReason: string | null;
  onRegenerate: () => void;
}

// Render order: actionable first, "keep" last.
const CATEGORY_ORDER: CurateCategory[] = ['remove', 'consolidate', 'stale', 'gap', 'keep'];

const CATEGORY_LABEL: Record<CurateCategory, string> = {
  remove: 'Remove',
  consolidate: 'Consolidate',
  stale: 'Stale / unused',
  gap: 'Gaps',
  keep: 'Keep',
};

const CATEGORY_CHIP: Record<CurateCategory, string> = {
  remove: 'bg-terracotta/15 text-terracotta',
  consolidate: 'bg-tertiary/20 text-tertiary',
  stale: 'bg-navy/10 text-navy-light',
  gap: 'bg-sage/20 text-sage',
  keep: 'bg-sage/20 text-sage',
};

/** Build a natural-language prompt for the Ask bridge from a finding. */
function fixPrompt(f: CurateFinding): string {
  const list = f.items.slice(0, 25).join('\n- ');
  const itemBlock = f.items.length > 0 ? `\n\nItems:\n- ${list}` : '';
  switch (f.category) {
    case 'remove':
      return `In my Claude Code setup (~/.claude), help me review and remove the following — confirm each with me before deleting. ${f.title}.${itemBlock}`;
    case 'consolidate':
      return `In my Claude Code setup (~/.claude), these capabilities are duplicated across local and plugin sources and may collide. Help me consolidate them. ${f.title}.${itemBlock}`;
    case 'stale':
      return `In my Claude Code setup (~/.claude), these look unused or stale. Help me decide what to archive or remove. ${f.title}.${itemBlock}`;
    default:
      return `In my Claude Code setup (~/.claude): ${f.title}.${itemBlock}`;
  }
}

function FindingCard({ finding }: { finding: CurateFinding }) {
  const requestAskCommand = useViewStore((s) => s.requestAskCommand);

  const handleFix = () => {
    void (async () => {
      const home = await homeDir();
      const claudeDir = await join(home, '.claude');
      requestAskCommand(claudeDir, fixPrompt(finding));
    })();
  };

  const border =
    finding.severity === 'warn'
      ? 'border-l-2 border-l-terracotta border-warm-gray'
      : 'border-warm-gray';

  return (
    <div className={`nb-card-sm ${border} p-3 flex flex-col gap-2`}>
      <div className="flex items-start gap-2">
        <p className="text-sm font-semibold text-navy leading-snug min-w-0 flex-1">
          {finding.title}
        </p>
        <span
          className={`nb-chip px-2 py-0.5 text-[10px] font-medium shrink-0 ${CATEGORY_CHIP[finding.category]}`}
        >
          {CATEGORY_LABEL[finding.category]}
        </span>
      </div>

      <p className="text-xs text-navy-light leading-snug">{finding.detail}</p>

      {finding.items.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {finding.items.slice(0, 12).map((it, i) => (
            <span
              key={i}
              className="nb-chip px-1.5 py-0.5 text-[10px] font-mono bg-navy/8 text-navy-light truncate max-w-[220px]"
              title={it}
            >
              {it}
            </span>
          ))}
          {finding.items.length > 12 && (
            <span className="px-1.5 py-0.5 text-[10px] text-navy-light/60">
              +{finding.items.length - 12} more
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleFix}
        className="nb-btn mt-auto pt-1 self-start flex items-center gap-1 px-2 py-1 text-navy-light hover:text-navy transition-colors cursor-pointer text-[11px]"
      >
        <Sparkles size={13} strokeWidth={1.75} /> Ask Claude to fix
      </button>
    </div>
  );
}

export function Recommendations({
  findings,
  narrative,
  loading,
  unavailableReason,
  onRegenerate,
}: RecommendationsProps) {
  const showBanner = narrative !== null || loading || unavailableReason !== null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <SectionHeader label="Setup Curator" />
        <button
          type="button"
          onClick={onRegenerate}
          disabled={loading}
          className="nb-btn flex items-center gap-1 px-2 py-1 text-navy-light hover:text-navy transition-colors cursor-pointer text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw size={12} strokeWidth={2} className={loading ? 'animate-spin' : ''} />{' '}
          Re-curate
        </button>
      </div>

      {/* AI narrative banner */}
      {showBanner && (
        <div className="nb-card-sm px-4 py-3">
          {loading && (
            <p className="text-sm text-navy-light animate-pulse">Generating narrative&hellip;</p>
          )}
          {unavailableReason !== null && !loading && (
            <p className="text-xs text-navy-light">{unavailableReason}</p>
          )}
          {narrative !== null && !loading && <MarkdownBody compact>{narrative}</MarkdownBody>}
        </div>
      )}

      {/* Findings */}
      {findings === null && loading && (
        <p className="text-sm text-navy-light text-center py-8 animate-pulse">
          Analyzing your setup&hellip;
        </p>
      )}

      {findings !== null && findings.length === 0 && (
        <p className="text-sm text-navy-light text-center py-8">
          Nothing to curate — your setup looks tidy.
        </p>
      )}

      {findings !== null &&
        findings.length > 0 &&
        CATEGORY_ORDER.map((cat) => {
          const group = findings.filter((f) => f.category === cat);
          if (group.length === 0) return null;
          return (
            <section key={cat}>
              <SectionHeader label={`${CATEGORY_LABEL[cat]} (${group.length})`} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
              </div>
            </section>
          );
        })}
    </div>
  );
}
