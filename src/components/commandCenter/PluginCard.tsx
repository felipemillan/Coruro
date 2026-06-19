// PluginCard.tsx — card for a single Claude plugin in the Command Center.

import type { ClaudePlugin } from '../../types';

type PluginCounts = { skills: number; agents: number; commands: number; mcp: number };

function buildPills(counts: PluginCounts): string[] {
  const pills: string[] = [];
  if (counts.skills) pills.push(`${counts.skills} skill${counts.skills === 1 ? '' : 's'}`);
  if (counts.agents) pills.push(`${counts.agents} agent${counts.agents === 1 ? '' : 's'}`);
  if (counts.commands) pills.push(`${counts.commands} cmd${counts.commands === 1 ? '' : 's'}`);
  if (counts.mcp) pills.push(`${counts.mcp} mcp`);
  return pills;
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={
        enabled
          ? 'nb-chip text-[10px] font-medium bg-sage/20 text-sage shrink-0'
          : 'nb-chip text-[10px] font-medium bg-warm-gray text-navy-light shrink-0'
      }
    >
      {enabled ? 'enabled' : 'disabled'}
    </span>
  );
}

/** One plugin rendered as a card: description, enabled state, content counts. */
export function PluginCard({ plugin, counts }: { plugin: ClaudePlugin; counts?: PluginCounts }) {
  const pills = counts ? buildPills(counts) : [];
  const borderCls = plugin.enabled ? 'hover:border-sage/30' : 'opacity-75';

  return (
    <div className={`nb-card-sm p-3 flex flex-col gap-2 transition-colors ${borderCls}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-navy flex-1 truncate">{plugin.name}</span>
        {plugin.version !== null && (
          <span className="text-[10px] text-navy-light tabular-nums shrink-0">
            v{plugin.version}
          </span>
        )}
        <EnabledBadge enabled={plugin.enabled} />
      </div>
      {plugin.description !== null && (
        <p className="text-xs text-navy-light leading-snug line-clamp-2">{plugin.description}</p>
      )}
      <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1">
        {plugin.marketplace !== null && (
          <span className="text-[10px] text-navy-light/70 font-mono truncate max-w-[140px]">
            {plugin.marketplace}
          </span>
        )}
        {pills.length > 0 && <span className="text-navy-light/30 text-[10px]">·</span>}
        {pills.map((p) => (
          <span key={p} className="nb-chip text-[10px] font-medium bg-navy/8 text-navy-light">
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}
