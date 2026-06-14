// SyncBadges.tsx — at-a-glance sync state for a repo card header.
// Renders a dirty/clean pill, ahead/behind counts, and a CI dot.

import { ArrowUp, ArrowDown, CircleDot } from 'lucide-react';
import type { CardData } from '../../utils/repoStats';

interface SyncBadgesProps {
  sync: CardData['sync'];
}

function ciColor(status: string): string | null {
  switch (status) {
    case 'success':
      return 'text-sage';
    case 'failure':
      return 'text-terracotta';
    case 'pending':
      return 'text-amber-500';
    default:
      return null;
  }
}

export function SyncBadges({ sync }: SyncBadgesProps) {
  const ci = ciColor(sync.ciStatus);
  return (
    <div className="flex items-center gap-2 text-[11px] leading-none">
      <span
        className={[
          'px-1.5 py-0.5 font-medium rounded-full',
          sync.dirty ? 'bg-terracotta/20 text-terracotta' : 'bg-sage/20 text-sage',
        ].join(' ')}
        aria-label={sync.dirty ? 'Uncommitted changes' : 'Working tree clean'}
      >
        {sync.dirty ? 'dirty' : 'clean'}
      </span>

      {sync.ahead > 0 && (
        <span className="flex items-center gap-0.5 text-sage" title="Commits ahead">
          <ArrowUp size={11} strokeWidth={2} />
          {sync.ahead}
        </span>
      )}
      {sync.behind > 0 && (
        <span className="flex items-center gap-0.5 text-amber-500" title="Commits behind">
          <ArrowDown size={11} strokeWidth={2} />
          {sync.behind}
        </span>
      )}

      {ci !== null && (
        <span className={`flex items-center gap-0.5 ${ci}`} title={`CI: ${sync.ciStatus}`}>
          <CircleDot size={11} strokeWidth={2} />
        </span>
      )}
    </div>
  );
}
