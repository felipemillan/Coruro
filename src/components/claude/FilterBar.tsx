// FilterBar.tsx — Reusable search input + segmented filter chip groups.
//
// Rendered as a flex-wrap row: a rounded-full search box on the left (mirrors
// the Toolbar search pattern) followed by zero or more segmented pill controls,
// one per FilterGroup. All state is lifted — this component is fully controlled.
//
// Palette: cream/warm-gray surface, text-navy/text-navy-light, sage accent,
// terracotta destructive, border-warm-gray. No dark or neon tokens.
//
// Accessibility: every chip is a real <button> with type="button", visible
// focus-visible ring, and labelled group wrapper. The search input has an
// explicit <label> (sr-only) so screen readers announce it.

import { Search } from 'lucide-react';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/** One segmented control group: a label, a list of option strings, and the
 *  currently selected value + its change handler. */
export interface FilterGroup {
  /** Unique key for React reconciliation and aria attributes. */
  key: string;
  /** Human-readable label shown above / as aria-label for the group. */
  label: string;
  /** The selectable option strings displayed as uppercase pill buttons. */
  options: string[];
  /** Currently active option value. Must be one of `options`. */
  value: string;
  /** Called with the newly selected option string when a chip is clicked. */
  onChange: (v: string) => void;
}

export interface FilterBarProps {
  /** Current search string (controlled). */
  search: string;
  /** Called on every keystroke with the updated search string. */
  onSearch: (v: string) => void;
  /** Input placeholder text. */
  placeholder?: string;
  /** Zero or more segmented chip groups rendered to the right of the search
   *  box. Omit or pass an empty array to show only the search input. */
  filters?: FilterGroup[];
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

/**
 * Reusable horizontal strip with a search box and optional segmented filter
 * chip groups. Fully controlled — no internal state.
 *
 * @example
 * ```tsx
 * <FilterBar
 *   search={q}
 *   onSearch={setQ}
 *   placeholder="Search skills…"
 *   filters={[
 *     { key: 'scope', label: 'Scope', options: ['All', 'Global', 'Project'],
 *       value: scope, onChange: setScope },
 *   ]}
 * />
 * ```
 */
export function FilterBar({
  search,
  onSearch,
  placeholder = 'Search…',
  filters = [],
}: FilterBarProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">

      {/* ── Search box — mirrors Toolbar search input ── */}
      <div className="relative flex items-center">
        {/* sr-only label for screen readers */}
        <label htmlFor="filter-bar-search" className="sr-only">
          {placeholder}
        </label>

        <Search
          size={13}
          strokeWidth={1.75}
          className="absolute left-2.5 text-navy-light/50 pointer-events-none"
          aria-hidden="true"
        />

        <input
          id="filter-bar-search"
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className={[
            'w-56 pl-8 pr-3 py-1.5',
            'rounded-full',
            'bg-warm-gray border border-warm-gray/80',
            'text-[12px] text-navy',
            'placeholder:text-navy-light/40',
            'focus:outline-none focus:border-navy/40 focus:bg-cream',
            'focus-visible:ring-2 focus-visible:ring-sage/50 focus-visible:ring-offset-1',
            'transition-colors duration-150',
          ].join(' ')}
        />
      </div>

      {/* ── Segmented chip groups ── */}
      {filters.map((group) => (
        <SegmentedGroup key={group.key} group={group} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SegmentedGroup — one pill-segmented control (bg-warm-gray pill tray)
// ---------------------------------------------------------------------------

/** @internal */
function SegmentedGroup({ group }: { group: FilterGroup }) {
  return (
    <div
      role="group"
      aria-label={group.label}
      className="flex items-center bg-warm-gray border border-warm-gray/80 rounded-lg p-1 gap-0.5"
    >
      {group.options.map((option) => {
        const isActive = option === group.value;
        return (
          <button
            key={option}
            type="button"
            onClick={() => group.onChange(option)}
            aria-pressed={isActive}
            className={[
              // base geometry
              'px-2.5 py-1 rounded-md leading-none',
              // text
              'text-[11px] font-bold uppercase tracking-wide',
              // transitions
              'transition-colors duration-150 cursor-pointer',
              // focus ring (a11y)
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/60 focus-visible:ring-offset-1',
              // active vs inactive
              isActive
                ? 'bg-sage text-cream shadow-sm'
                : 'text-navy-light hover:text-navy hover:bg-warm-gray/50',
            ].join(' ')}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
