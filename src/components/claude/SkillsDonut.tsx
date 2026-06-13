// SkillsDonut.tsx — SVG donut ring + per-source meter list for Claude skills.
// Visualizes skills aggregated by source (e.g. local, posthog, supabase) as a
// hand-rolled SVG ring whose segment lengths equal each source's percentage,
// paired with an accessible meter list that is the real, color-independent
// content. Hovering a ring segment or a meter row syncs a shared highlight and
// swaps the ring's center overlay to that group's label / value / percentage.

import { useState } from 'react';
import { Sparkles } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillsDonutProps {
  /**
   * Per-source skill counts, already aggregated upstream — one entry per
   * origin, e.g. `[{ label: 'local', value: 110 }, { label: 'posthog', value: 81 }]`.
   * Order is irrelevant; the component sorts descending by value, with `local`
   * pinned first so it always maps to the lead (sage) color.
   */
  groups: { label: string; value: number }[];
}

// ---------------------------------------------------------------------------
// Warm color ramp — derived from the Coruro palette. `local` (lead) → sage.
// ---------------------------------------------------------------------------

const RAMP = [
  '#4C662B', // sage
  '#386663', // tertiary
  '#586249', // secondary
  '#6E8B3D',
  '#BCECE7',
  '#CDEDA3',
  '#75796C',
  '#44483D',
] as const;

/** Ring geometry. pathLength=100 lets us express every length as a raw percent. */
const RADIUS = 82;
const STROKE = 18;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Donut ring + meter list of skills grouped by source.
 *
 * Dash math: the `<circle>` declares `pathLength={100}`, so its circumference
 * is normalized to 100 user units regardless of radius. Each segment then sets
 * `strokeDasharray = "<pct> <rest>"` (a dash of length = its percentage, then a
 * gap covering the remainder) and `strokeDashoffset = 100 - accumulated`, where
 * `accumulated` is the sum of all *preceding* segments' percentages. SVG draws
 * dashes clockwise from the path start but offsets shift the pattern backward,
 * so `100 - accumulated` advances each segment's start to exactly where the
 * previous one ended — segments chain without overlap and sum to 100. We
 * accumulate *after* placing each segment, and rotate the whole ring -90° so it
 * begins at 12 o'clock instead of 3 o'clock.
 */
export function SkillsDonut({ groups }: SkillsDonutProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const total = groups.reduce((sum, g) => sum + g.value, 0);

  // Sort descending by value, pinning `local` first so it always gets sage.
  const sorted = [...groups].sort((a, b) => {
    if (a.label === 'local' && b.label !== 'local') return -1;
    if (b.label === 'local' && a.label !== 'local') return 1;
    return b.value - a.value;
  });

  // Empty state — nothing to chart.
  if (total <= 0 || sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-warm-gray bg-cream/60 px-4 py-8 gap-2">
        <Sparkles size={14} strokeWidth={1.75} className="text-navy-light" />
        <span className="text-sm text-navy-light">No skills</span>
      </div>
    );
  }

  // Pre-compute each segment's percentage, color and accumulated offset.
  let accumulated = 0;
  const segments = sorted.map((g, i) => {
    const pct = (g.value / total) * 100;
    const offset = 100 - accumulated; // start of this segment along the ring
    accumulated += pct; // accumulate AFTER placing, so the next starts where this ends
    return {
      label: g.label,
      value: g.value,
      pct,
      color: RAMP[i % RAMP.length],
      offset,
    };
  });

  const active = hovered !== null ? segments[hovered] : null;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      {/* ── Donut ring (decorative) ─────────────────────────────────────── */}
      <div className="relative shrink-0" style={{ width: 200, height: 200 }}>
        <svg
          viewBox="0 0 200 200"
          width={200}
          height={200}
          role="img"
          aria-label={`Skills by source: ${total} total across ${segments.length} sources`}
        >
          <title>{`Skills by source: ${total} total`}</title>
          {/* Track behind the segments for a soft, continuous ring base. */}
          <circle
            cx={100}
            cy={100}
            r={RADIUS}
            fill="none"
            stroke="#E7E3DA"
            strokeWidth={STROKE}
          />
          {/* Rotate -90° so the ring starts at the top (12 o'clock). */}
          <g transform="rotate(-90 100 100)">
            {segments.map((seg, i) => (
              <circle
                key={`${seg.label}-${i}`}
                cx={100}
                cy={100}
                r={RADIUS}
                fill="none"
                stroke={seg.color}
                strokeWidth={STROKE}
                pathLength={100}
                strokeDasharray={`${seg.pct} ${100 - seg.pct}`}
                strokeDashoffset={seg.offset}
                strokeLinecap="butt"
                className="cursor-pointer transition-opacity duration-150"
                style={{ opacity: hovered === null || hovered === i ? 1 : 0.3 }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                aria-hidden="true"
              />
            ))}
          </g>
        </svg>

        {/* Center overlay — total + "SKILLS", or the hovered group's detail. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-6">
          {active === null ? (
            <>
              <span className="text-3xl font-bold text-navy tabular-nums leading-none">
                {total}
              </span>
              <span className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-navy-light">
                Skills
              </span>
            </>
          ) : (
            <>
              <span className="text-2xl font-bold text-navy tabular-nums leading-none">
                {active.value}
              </span>
              <span className="mt-1 text-sm font-medium text-navy truncate max-w-[120px]">
                {active.label}
              </span>
              <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-navy-light tabular-nums">
                {active.pct.toFixed(active.pct < 10 ? 1 : 0)}%
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Meter list (the real, color-independent content) ────────────── */}
      <ul className="flex-1 w-full max-h-[200px] overflow-y-auto pr-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
        {segments.map((seg, i) => (
          <li
            key={`${seg.label}-${i}`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            className={[
              'group rounded-lg px-2 py-1.5 cursor-default transition-colors',
              hovered === i ? 'bg-navy/[0.04]' : '',
            ].join(' ')}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full shrink-0"
                style={{ backgroundColor: seg.color }}
              />
              <span className="text-sm text-navy flex-1 truncate">{seg.label}</span>
              <span className="text-sm font-semibold text-navy tabular-nums shrink-0">
                {seg.value}
              </span>
              <span className="text-[10px] text-navy-light tabular-nums shrink-0 w-9 text-right">
                {seg.pct.toFixed(seg.pct < 10 ? 1 : 0)}%
              </span>
            </div>
            {/* Thin proportional bar — secondary cue, not the only signal. */}
            <div className="mt-1 ml-[18px] h-1 rounded-full bg-warm-gray/60 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${seg.pct}%`, backgroundColor: seg.color }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
