// CardHeader.tsx — the tinted top band of a repo card: language dot + label,
// a faint watermark of the repo initials, and the sync-state badge row.

import { languageColor } from '../../utils/languageColor';
import { SyncBadges } from './SyncBadges';
import type { CardData } from '../../utils/repoStats';

interface CardHeaderProps {
  name: string;
  language: string | null;
  sync: CardData['sync'];
}

/** First two alphanumeric chars of the name, uppercased (watermark). */
function initials(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9]/g, '');
  return clean.slice(0, 2).toUpperCase();
}

export function CardHeader({ name, language, sync }: CardHeaderProps) {
  const color = languageColor(language);
  return (
    <div
      className="relative overflow-hidden rounded-t-xl px-3 py-2 flex items-center justify-between"
      style={{ background: `${color}1a` }} // ~10% alpha tint
    >
      {/* Watermark initials */}
      <span
        className="pointer-events-none absolute -right-1 -bottom-3 text-4xl font-black leading-none select-none"
        style={{ color: `${color}26` }} // ~15% alpha
        aria-hidden="true"
      >
        {initials(name)}
      </span>

      <span className="relative flex items-center gap-1.5 text-[11px] font-medium text-navy">
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ background: color }}
          aria-hidden="true"
        />
        {language && <span>{language}</span>}
      </span>

      <span className="relative">
        <SyncBadges sync={sync} />
      </span>
    </div>
  );
}
