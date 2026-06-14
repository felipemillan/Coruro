// GroupedList.tsx — source-grouped inventory list shared by the Command Center.

import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Chip helpers
// ---------------------------------------------------------------------------

export function EventChip({ event }: { event: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-terracotta/15 text-terracotta shrink-0">
      {event}
    </span>
  );
}

export function SourceChip({ source }: { source: 'settings' | 'script' }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-navy/8 text-navy-light shrink-0">
      {source}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Grouping helpers — bucket source-tagged items by origin for the inventory.
// 'local'/'user' groups sort first; the rest by descending count, then name.
// ---------------------------------------------------------------------------

export function groupBySource<T extends { source: string }>(items: T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const arr = m.get(it.source);
    if (arr === undefined) m.set(it.source, [it]);
    else arr.push(it);
  }
  const isBase = (k: string): boolean => k === 'local' || k === 'user';
  return [...m.entries()].sort((a, b) => {
    if (isBase(a[0]) && !isBase(b[0])) return -1;
    if (isBase(b[0]) && !isBase(a[0])) return 1;
    return b[1].length - a[1].length || a[0].localeCompare(b[0]);
  });
}

/** Sub-header row that labels one source group with its item count. */
function GroupHeader({ source, count }: { source: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-3 py-1 bg-navy/[0.04] border-b border-warm-gray/50">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-light truncate">
        {source}
      </span>
      <span className="text-[10px] tabular-nums text-navy-light shrink-0 ml-2">{count}</span>
    </div>
  );
}

/**
 * Render a source-grouped inventory list: one GroupHeader per origin, items
 * beneath. `renderItem`/`keyFor` keep each category's row markup local.
 */
export function GroupedList<T extends { source: string }>({
  items,
  renderItem,
  keyFor,
}: {
  items: T[];
  renderItem: (item: T) => ReactNode;
  keyFor: (item: T, index: number) => string;
}) {
  const groups = groupBySource(items);
  return (
    <div className="rounded-xl border border-warm-gray bg-cream/60 overflow-hidden">
      {groups.map(([source, list]) => (
        <div key={source}>
          <GroupHeader source={source} count={list.length} />
          <div className="divide-y divide-warm-gray/50">
            {list.map((item, i) => (
              <div key={keyFor(item, i)}>{renderItem(item)}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
