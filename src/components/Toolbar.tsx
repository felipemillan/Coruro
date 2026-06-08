// Toolbar.tsx — Board filter / search / sort strip.
//
// Horizontal shrink-0 strip rendered above the Kanban columns.
// Reads and writes ephemeral view state via useViewStore (zustand).
// Never persisted — runtime lens only.
//
// Design contract: rounded-none, indie pastel palette, text-[11px]/[12px],
// lucide-react icons with strokeWidth 1.5–1.75, transition-colors duration-150.

import { Search, ArrowUpDown, X, Settings as SettingsIcon } from 'lucide-react';
import { useViewStore } from '../store/useViewStore';
import {
  FILTER_KEYS,
  FILTER_LABELS,
  SORT_MODES,
  SORT_LABELS,
  isViewActive,
  type FilterKey,
  type SortMode,
} from '../view';

interface ToolbarProps {
  /** Opens the controlled Settings modal (state lives in App). */
  onOpenSettings: () => void;
}

export function Toolbar({ onOpenSettings }: ToolbarProps) {
  // Individual selectors — do not destructure the whole store in one selector.
  const search = useViewStore((s) => s.search);
  const filters = useViewStore((s) => s.filters);
  const sort = useViewStore((s) => s.sort);
  const setSearch = useViewStore((s) => s.setSearch);
  const toggleFilter = useViewStore((s) => s.toggleFilter);
  const resetView = useViewStore((s) => s.resetView);

  const viewActive = isViewActive({ search, filters, sort });

  return (
    <div className="px-4 py-2 border-b border-warm-gray bg-cream/80 backdrop-blur-sm flex items-center gap-3 flex-wrap shrink-0">

      {/* ── Brand — moved here from the old standalone nav bar ── */}
      <span className="text-[13px] font-semibold tracking-wide text-navy select-none shrink-0">
        Coruro
      </span>

      {/* ── Search input ── */}
      <div className="relative flex items-center">
        <Search
          size={13}
          strokeWidth={1.5}
          className="absolute left-2.5 text-navy-light/50 pointer-events-none"
        />
        <input
          id="repo-search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, language, branch…"
          spellCheck={false}
          autoComplete="off"
          className="
            w-64 pl-8 pr-3 py-1.5
            rounded-full
            bg-warm-gray border border-warm-gray/80
            text-[12px] font-mono text-navy
            placeholder:text-navy-light/40
            focus:outline-none focus:border-navy/40 focus:bg-cream
            transition-colors duration-150
          "
        />
      </div>

      {/* ── Filter chips ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTER_KEYS.map((key: FilterKey) => {
          const active = filters.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleFilter(key)}
              className={[
                'text-[11px] px-2 py-1 leading-none font-medium',
                'rounded-full transition-colors duration-150 cursor-pointer',
                active
                  ? 'bg-sage text-cream'
                  : 'bg-warm-gray text-navy-light hover:bg-warm-gray/70',
              ].join(' ')}
            >
              {FILTER_LABELS[key]}
            </button>
          );
        })}
      </div>

      {/* ── Sort dropdown ── */}
      <div className="flex items-center gap-1.5">
        <ArrowUpDown
          size={13}
          strokeWidth={1.5}
          className="text-navy-light/50 shrink-0"
        />
        <select
          value={sort}
          onChange={(e) => {
            const val = e.target.value as SortMode;
            useViewStore.getState().setSort(val);
          }}
          className="
            rounded-lg
            bg-warm-gray border border-warm-gray/80
            text-[12px] text-navy
            px-2 py-1.5
            focus:outline-none focus:border-navy/40
            transition-colors duration-150
            cursor-pointer
          "
        >
          {SORT_MODES.map((mode: SortMode) => (
            <option key={mode} value={mode}>
              {SORT_LABELS[mode]}
            </option>
          ))}
        </select>
      </div>

      {/* ── Clear button — visible only when any view transform is active ── */}
      {viewActive && (
        <button
          type="button"
          onClick={() => resetView()}
          className="
            flex items-center gap-1
            rounded-full
            text-[11px] text-navy-light hover:text-navy
            transition-colors duration-150 cursor-pointer
          "
        >
          <X size={12} strokeWidth={1.5} />
          Clear
        </button>
      )}

      {/* ── Settings gear — pushed to the far right ── */}
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Open settings"
        title="Settings (⌘,)"
        className="
          ml-auto shrink-0
          flex items-center justify-center
          w-8 h-8 rounded-full
          text-navy-light hover:text-navy hover:bg-warm-gray
          transition-colors duration-150
          cursor-pointer
        "
      >
        <SettingsIcon size={18} strokeWidth={1.5} />
      </button>
    </div>
  );
}
