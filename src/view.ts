// Runtime-only view layer for the Board: search, filters, sort, selection.
//
// NONE of this is persisted — it is an ephemeral lens over the scanned repos.
// The persisted `board` column order (manual drag order) remains the source of
// truth; view transforms only affect what is *rendered*, never what is saved.
//
// Shared contracts live here so the pure helpers (filterSort.ts), the zustand
// slice (useViewStore.ts), the Toolbar, and the Board all agree on one shape.

/** Sort modes for the in-column view. `manual` = persisted drag order. */
export type SortMode = 'manual' | 'pushed' | 'name' | 'stars';

/** Ordered list for the sort dropdown — single source of truth. */
export const SORT_MODES: readonly SortMode[] = ['manual', 'pushed', 'name', 'stars'] as const;

/** Human labels for each sort mode. */
export const SORT_LABELS: Record<SortMode, string> = {
  manual: 'Manual',
  pushed: 'Last push',
  name: 'Name A–Z',
  stars: 'Stars',
};

/** Quick-filter chip keys. All active filters AND together. */
export type FilterKey = 'dirty' | 'prs' | 'issues' | 'stale' | 'private' | 'fork' | 'ciFailing';

/** Ordered list for rendering the filter chips — single source of truth. */
export const FILTER_KEYS: readonly FilterKey[] = [
  'dirty',
  'prs',
  'issues',
  'stale',
  'private',
  'fork',
  'ciFailing',
] as const;

/** Human labels for each filter chip. */
export const FILTER_LABELS: Record<FilterKey, string> = {
  dirty: 'Dirty',
  prs: 'Has PRs',
  issues: 'Has issues',
  stale: 'Stale >90d',
  private: 'Private',
  fork: 'Fork',
  ciFailing: 'CI failing',
};

/** Staleness threshold (days) for the `stale` filter. */
export const STALE_DAYS = 90;

/** Runtime view state. Never serialised to disk. */
export interface ViewState {
  /** Free-text query matched against name + language + branch. */
  search: string;
  /** Active quick filters; empty set = no filtering. */
  filters: Set<FilterKey>;
  /** Current sort mode (`manual` keeps persisted drag order). */
  sort: SortMode;
  /** Path of the keyboard-selected card, or null. */
  selectedPath: string | null;
}

/**
 * True when any view transform is active. Drag-and-drop MUST be disabled while
 * this is true: filtering/sorting changes the rendered list, so a drag index
 * would no longer map onto the persisted column array and could corrupt order.
 */
export function isViewActive(v: Pick<ViewState, 'search' | 'filters' | 'sort'>): boolean {
  return v.search.trim() !== '' || v.filters.size > 0 || v.sort !== 'manual';
}
