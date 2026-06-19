// OverviewSubTab.tsx — Overview sub-tab for the Command Center.

import type { ClaudeInventory, ClaudePlugin } from '../../types';
import { SkillsDonut } from '../claude/SkillsDonut';
import { FilterBar } from '../claude/FilterBar';
import type { FilterGroup } from '../claude/FilterBar';
import { SectionHeader } from '../claude/markdownComponents';
import { EventChip, SourceChip } from './GroupedList';
import { PluginCard } from './PluginCard';

// ---------------------------------------------------------------------------
// Internal sub-sections
// ---------------------------------------------------------------------------

function HooksSection({ hooks }: { hooks: ClaudeInventory['hooks'] }) {
  if (hooks.length === 0) return null;
  return (
    <section>
      <SectionHeader label={`Hooks (${hooks.length})`} />
      <div className="nb-card divide-y divide-warm-gray/50">
        {hooks.map((hook, i) => (
          <div key={`${hook.event}-${i}`} className="flex items-start gap-2 px-3 py-2 flex-wrap">
            <EventChip event={hook.event} />
            <span className="text-xs font-mono text-navy-light flex-1 min-w-0 truncate self-center">
              {hook.commandPreview}
            </span>
            <SourceChip source={hook.source} />
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsSection({ settings }: { settings: NonNullable<ClaudeInventory['settings']> }) {
  return (
    <section>
      <SectionHeader label="Settings" />
      <div className="nb-card divide-y divide-warm-gray/50">
        {settings.model !== null && (
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-light w-20 shrink-0">
              Model
            </span>
            <span className="text-sm font-mono text-navy">{settings.model}</span>
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-light w-20 shrink-0">
            Allow
          </span>
          <span className="text-sm tabular-nums text-navy">
            {settings.permissions.allow.length} rules
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-light w-20 shrink-0">
            Deny
          </span>
          <span className="text-sm tabular-nums text-navy">
            {settings.permissions.deny.length} rules
          </span>
        </div>
        {settings.envKeys.length > 0 && (
          <div className="flex items-start gap-2 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-light w-20 shrink-0 mt-0.5">
              Env Keys
            </span>
            <div className="flex flex-wrap gap-1">
              {settings.envKeys.map((key) => (
                <span key={key} className="nb-chip text-[10px] font-mono bg-navy/8 text-navy-light">
                  {key}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function GlobalMemorySection({
  globalMemory,
}: {
  globalMemory: NonNullable<ClaudeInventory['globalMemory']>;
}) {
  return (
    <section>
      <SectionHeader label="Global Memory (CLAUDE.md)" />
      <div className="nb-card px-3 py-2 flex items-center gap-3">
        <span
          className={
            globalMemory.present
              ? 'nb-chip text-[10px] font-medium bg-sage/20 text-sage'
              : 'nb-chip text-[10px] font-medium bg-warm-gray text-navy-light'
          }
        >
          {globalMemory.present ? 'present' : 'absent'}
        </span>
        {globalMemory.present && (
          <span className="text-xs text-navy-light tabular-nums">
            {globalMemory.charCount.toLocaleString()} chars
          </span>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

interface OverviewSubTabProps {
  inventory: ClaudeInventory;
  skillGroups: { label: string; value: number }[];
  enabledPlugins: number;
  filteredPlugins: ClaudePlugin[];
  pluginCounts: Record<string, { skills: number; agents: number; commands: number; mcp: number }>;
  pluginSearch: string;
  onPluginSearch: (v: string) => void;
  pluginFilter: string;
  onPluginFilter: (v: string) => void;
  enrichUnavailableReason: string | null;
}

export function OverviewSubTab({
  inventory,
  skillGroups,
  enabledPlugins,
  filteredPlugins,
  pluginCounts,
  pluginSearch,
  onPluginSearch,
  pluginFilter,
  onPluginFilter,
  enrichUnavailableReason,
}: OverviewSubTabProps) {
  return (
    <>
      {/* Skills donut */}
      <section>
        <SectionHeader label="Skills by Source" />
        <div className="nb-card p-4">
          <SkillsDonut groups={skillGroups} />
        </div>
      </section>

      {/* Hooks / Settings / Global Memory — 3-column grid on wide screens */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <HooksSection hooks={inventory.hooks} />
        {inventory.settings !== null && <SettingsSection settings={inventory.settings} />}
        {inventory.globalMemory !== null && (
          <GlobalMemorySection globalMemory={inventory.globalMemory} />
        )}
      </div>

      {enrichUnavailableReason !== null && (
        <p className="text-xs text-navy-light">{enrichUnavailableReason}</p>
      )}

      {/* Plugins — card grid with description + enabled state + content counts */}
      {inventory.plugins.length > 0 && (
        <section>
          <SectionHeader
            label={`Plugins (${inventory.plugins.length} — ${enabledPlugins} on / ${
              inventory.plugins.length - enabledPlugins
            } off)`}
          />
          <div className="mb-3">
            <FilterBar
              search={pluginSearch}
              onSearch={onPluginSearch}
              placeholder="Search plugins…"
              filters={[
                {
                  key: 'state',
                  label: 'State',
                  options: ['all', 'enabled', 'disabled'],
                  value: pluginFilter,
                  onChange: onPluginFilter,
                } satisfies FilterGroup,
              ]}
            />
          </div>
          {filteredPlugins.length === 0 ? (
            <p className="text-sm text-navy-light text-center py-8">No plugins match.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredPlugins.map((plugin, i) => (
                <PluginCard
                  key={`${plugin.name}-${i}`}
                  plugin={plugin}
                  counts={pluginCounts[plugin.name]}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
