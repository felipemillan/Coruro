// StatGrid.tsx — the divider-separated 3-stat grid on a repo card.
// Values/labels are pre-derived by repoStats; this component is presentational.

import type { CardStat } from '../../utils/repoStats';

interface StatGridProps {
  stats: CardStat[];
}

export function StatGrid({ stats }: StatGridProps) {
  return (
    <div className="grid grid-cols-3 border-t border-navy/10">
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={[
            'py-1.5 px-1 text-center',
            i < stats.length - 1 ? 'border-r border-navy/10' : '',
          ].join(' ')}
        >
          <span className="block text-navy font-semibold text-sm leading-none tabular-nums">
            {s.value}
          </span>
          <span className="block text-navy-light text-[9px] font-bold tracking-wider mt-0.5">
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}
