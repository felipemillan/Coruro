// SessionsTable.tsx — Project sessions table for the Claude Command Center.
//
// Renders a sorted table of ClaudeSessionStat entries with three columns:
//   PROJECT     — humanized slug (last path segment) with full slug in title attr
//   TRANSCRIPTS — tabular count + thin proportional activity bar vs. max
//   LAST MODIFIED — relative time from epoch ms ("5h ago", "2d ago", "—")
//
// If an AI blurb exists for a session (keyed "session:<projectSlug>"),
// it renders as a muted second line under the project name with an "AI" pill.
//
// Sort order: transcriptCount desc (primary), lastModified desc (secondary).
//
// Palette (warm — no dark/neon tokens):
//   bg-warm-gray header · bg-cream/60 body · text-navy primary ·
//   text-navy-light muted · sage activity bar · border-warm-gray dividers ·
//   hover:bg-navy/[0.03] row hover

import type { ClaudeSessionStat } from '../../types';

// ---------------------------------------------------------------------------
// relativeTime — pure helper, exported for testing
// ---------------------------------------------------------------------------

/**
 * Convert an epoch-millisecond timestamp to a human-readable relative string
 * (e.g. "just now", "45m ago", "3h ago", "8d ago", "4w ago").
 *
 * @param ms - Epoch milliseconds from Date.now() / lastModified
 * @returns A short relative-time string ("Xs ago" / "just now")
 */
export function relativeTime(ms: number): string {
  const diffMs = Date.now() - ms;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  const diffWk = Math.floor(diffDay / 7);
  return `${diffWk}w ago`;
}

// ---------------------------------------------------------------------------
// humanizeSlug — extract the last meaningful segment from the encoded slug
// ---------------------------------------------------------------------------

/**
 * Humanize a Claude project slug for display. The slug is a filesystem-safe
 * encoding of the original path (hyphens encode path separators), so we take
 * the last non-empty segment and restore word spacing.
 *
 * @param slug - Raw projectSlug from ClaudeSessionStat
 * @returns Short, readable label (full slug preserved in title attr by caller)
 */
function humanizeSlug(slug: string): string {
  // Slugs are encoded absolute paths: e.g. "-Users-admin-Github-Coruro"
  // Split on "-" but re-join segments that look like one word.
  const segments = slug.split('-').filter(Boolean);
  // Return the last segment if present, else the whole slug.
  return segments.length > 0 ? (segments[segments.length - 1] ?? slug) : slug;
}

// ---------------------------------------------------------------------------
// ActivityBar — thin proportional bar (sage)
// ---------------------------------------------------------------------------

interface ActivityBarProps {
  /** Count for this row. */
  value: number;
  /** Maximum count across all rows (denominator). */
  max: number;
}

function ActivityBar({ value, max }: ActivityBarProps) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;

  return (
    <div
      aria-hidden="true"
      className="mt-1 h-[3px] rounded-full bg-warm-gray overflow-hidden"
      style={{ width: '100%', maxWidth: 80 }}
    >
      <div className="h-full rounded-full bg-sage/70" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AiPill — small inline badge that labels AI-generated blurbs
// ---------------------------------------------------------------------------

function AiPill() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide bg-sage/15 text-sage shrink-0 leading-none">
      AI
    </span>
  );
}

// ---------------------------------------------------------------------------
// SessionsTable — main export
// ---------------------------------------------------------------------------

export interface SessionsTableProps {
  /** Array of session stats produced by the Claude scanner. */
  sessions: ClaudeSessionStat[];
  /**
   * Optional map of AI-generated blurbs keyed as "session:<projectSlug>".
   * When a matching key is present the blurb renders as a second line under
   * the project name, preceded by an AiPill badge.
   */
  blurbs?: Record<string, string>;
}

/**
 * SessionsTable — sortable transcript-count + relative-mtime table.
 *
 * Rows are sorted: transcriptCount desc, then lastModified desc (nulls last).
 * The TRANSCRIPTS column includes a thin proportional bar relative to the
 * row with the highest transcript count ("activity" indicator — no invented
 * risk scoring).
 *
 * @example
 * ```tsx
 * <SessionsTable sessions={inventory.sessions} blurbs={enrichments} />
 * ```
 */
export function SessionsTable({ sessions, blurbs = {} }: SessionsTableProps) {
  // ── Sort: transcriptCount desc, then lastModified desc (nulls last) ──────
  const sorted = [...sessions].sort((a, b) => {
    if (b.transcriptCount !== a.transcriptCount) {
      return b.transcriptCount - a.transcriptCount;
    }
    const aMs = a.lastModified ?? -1;
    const bMs = b.lastModified ?? -1;
    return bMs - aMs;
  });

  // ── Max transcript count — denominator for activity bars ─────────────────
  const maxCount = sorted.reduce((acc, s) => Math.max(acc, s.transcriptCount), 0);

  // ── Empty state ───────────────────────────────────────────────────────────
  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-warm-gray bg-cream/60 px-4 py-6 text-center">
        <p className="text-sm text-navy-light">No session data found.</p>
      </div>
    );
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-warm-gray bg-cream/60 overflow-hidden">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-warm-gray">
            <th
              scope="col"
              className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-navy-light font-normal"
            >
              Project
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-navy-light font-normal w-36"
            >
              Transcripts
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-navy-light font-normal w-28 whitespace-nowrap"
            >
              Last Modified
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-warm-gray/50">
          {sorted.map((session) => {
            const displayName = humanizeSlug(session.projectSlug);
            const blurbKey = `session:${session.projectSlug}`;
            const blurb = blurbs[blurbKey] ?? null;
            const relMtime =
              session.lastModified !== null ? relativeTime(session.lastModified) : '—';

            return (
              <tr
                key={session.projectSlug}
                className="hover:bg-navy/[0.03] transition-colors duration-100"
              >
                {/* PROJECT */}
                <td className="px-3 py-2 align-top">
                  <span
                    className="text-sm font-medium text-navy leading-snug block truncate"
                    title={session.projectSlug}
                  >
                    {displayName}
                  </span>
                  {blurb !== null && (
                    <span className="flex items-start gap-1.5 mt-0.5">
                      <AiPill />
                      <span className="text-[11px] text-navy-light leading-snug">{blurb}</span>
                    </span>
                  )}
                </td>

                {/* TRANSCRIPTS */}
                <td className="px-3 py-2 align-top w-36">
                  <span className="text-sm tabular-nums text-navy leading-snug">
                    {session.transcriptCount}
                  </span>
                  <ActivityBar value={session.transcriptCount} max={maxCount} />
                </td>

                {/* LAST MODIFIED */}
                <td className="px-3 py-2 align-top w-28">
                  <span className="text-sm tabular-nums text-navy-light leading-snug whitespace-nowrap">
                    {relMtime}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
