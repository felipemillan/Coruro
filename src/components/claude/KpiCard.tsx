// KpiCard.tsx — KPI stat card for the Claude Command Center.
// Renders a headline value, an optional active/total fraction with a thin
// progress bar, and a small caption label. Display-only (not interactive).

/** Accent palette choices for the filled progress bar and hover border. */
type KpiAccent = 'sage' | 'tertiary' | 'terracotta' | 'navy';

export interface KpiCardProps {
  /** Section label rendered in uppercase above the value. e.g. "MCP Servers" */
  label: string;
  /** Headline number (the active count when `total` is provided). */
  value: number;
  /**
   * When present renders "value / total" and sizes the bar proportionally.
   * If `total` is 0 the bar width defaults to 0% to avoid divide-by-zero.
   */
  total?: number;
  /**
   * Small monospace note shown instead of a fraction when `total` is absent.
   * e.g. "UNIQUE"
   */
  caption?: string;
  /**
   * Color accent used for the filled progress bar and the hover border tint.
   * Defaults to 'sage'.
   */
  accent?: KpiAccent;
}

// ---------------------------------------------------------------------------
// Accent → Tailwind class maps (static so Tailwind can detect them at build).
// ---------------------------------------------------------------------------

const barColor: Record<KpiAccent, string> = {
  sage: 'bg-sage',
  tertiary: 'bg-tertiary',
  terracotta: 'bg-terracotta',
  navy: 'bg-navy',
};

const hoverBorder: Record<KpiAccent, string> = {
  sage: 'hover:border-sage/40',
  tertiary: 'hover:border-tertiary/40',
  terracotta: 'hover:border-terracotta/40',
  navy: 'hover:border-navy/40',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * KpiCard — a compact KPI tile used in the Claude Command Center stat row.
 *
 * @example
 * // Simple count with a caption note
 * <KpiCard label="MCP Servers" value={12} caption="UNIQUE" />
 *
 * @example
 * // Active / total with a proportional progress bar
 * <KpiCard label="Plugins" value={3} total={8} accent="tertiary" />
 */
export function KpiCard({ label, value, total, caption, accent = 'sage' }: KpiCardProps) {
  // Guard divide-by-zero: if total is 0 the bar stays at 0%.
  const pct = total !== undefined && total > 0 ? Math.min((value / total) * 100, 100) : 0;
  // When total is provided, show the fraction; otherwise show caption (if any).
  const hasTotal = total !== undefined;

  return (
    <div
      className={[
        'rounded-xl border border-warm-gray bg-cream/60 p-3',
        'transition-colors duration-150',
        hoverBorder[accent],
      ].join(' ')}
    >
      {/* Label */}
      <p className="text-[10px] font-semibold uppercase tracking-widest text-navy-light mb-1.5 leading-none">
        {label}
      </p>

      {/* Value row */}
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="text-2xl font-bold text-navy tabular-nums leading-none">{value}</span>

        {hasTotal && (
          <span className="text-[11px] text-navy-light tabular-nums leading-none">
            {'/ '}
            {total}
          </span>
        )}

        {!hasTotal && caption && (
          <span className="text-[11px] font-mono text-navy-light leading-none tracking-wide">
            {caption}
          </span>
        )}
      </div>

      {/* Progress track — always rendered so the card height is stable */}
      <div className="h-px w-full bg-navy/10 rounded-full overflow-hidden">
        <div
          className={['h-full rounded-full', barColor[accent]].join(' ')}
          style={{ width: hasTotal ? `${pct}%` : '100%' }}
        />
      </div>
    </div>
  );
}
