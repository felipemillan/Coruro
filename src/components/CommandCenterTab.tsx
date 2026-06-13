// CommandCenterTab.tsx — Claude Command Center full-tab dashboard.
// A sub-tabbed view over the scanned ~/.claude inventory: MCP servers, skills,
// agents/commands, plugins, hooks, settings, and project sessions. KPI cards
// headline the counts; a SubTabNav switches between focused sub-views. On-device
// AI enrichment adds short, clearly-labelled blurbs to MCP cards and sessions.
// An AI health panel renders a generated Markdown summary when available, and
// quick-action buttons dispatch natural-language prompts to the Ask tab.

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RefreshCw, Sparkles, Server, Webhook, Wrench, SquareTerminal, FileJson } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { homeDir, join } from '@tauri-apps/api/path';
import { useClaudeStore } from '../store/useClaudeStore';
import { useViewStore } from '../store/useViewStore';
import { useBoardStore } from '../store/useBoardStore';
import { KpiCard } from './claude/KpiCard';
import { SubTabNav } from './claude/SubTabNav';
import type { ClaudeSubTab } from './claude/SubTabNav';
import { SkillsDonut } from './claude/SkillsDonut';
import { FilterBar } from './claude/FilterBar';
import type { FilterGroup } from './claude/FilterBar';
import { McpCard, SkillCard, AgentCard } from './claude/InventoryCards';
import { SessionsTable } from './claude/SessionsTable';
import { ClaudeDetail, type ClaudeDetailEntity } from './claude/ClaudeDetail';
import { Recommendations } from './claude/Recommendations';
import { mdComponents, SectionHeader } from './claude/markdownComponents';
import type { ClaudePlugin } from '../types';

// ---------------------------------------------------------------------------
// Markdown renderer components for the AI health panel (mirrors NotesTab style)
// ---------------------------------------------------------------------------

// mdComponents + SectionHeader now live in ./claude/markdownComponents (shared
// with the Setup Curator narrative).

// ---------------------------------------------------------------------------
// Chip helpers
// ---------------------------------------------------------------------------

function EventChip({ event }: { event: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-terracotta/15 text-terracotta shrink-0">
      {event}
    </span>
  );
}

function SourceChip({ source }: { source: 'settings' | 'script' }) {
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

function groupBySource<T extends { source: string }>(items: T[]): [string, T[]][] {
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
function GroupedList<T extends { source: string }>({
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

/** One plugin rendered as a card: description, enabled state, content counts. */
function PluginCard({
  plugin,
  counts,
}: {
  plugin: ClaudePlugin;
  counts?: { skills: number; agents: number; commands: number; mcp: number };
}) {
  const pills: string[] = [];
  if (counts) {
    if (counts.skills) pills.push(`${counts.skills} skill${counts.skills === 1 ? '' : 's'}`);
    if (counts.agents) pills.push(`${counts.agents} agent${counts.agents === 1 ? '' : 's'}`);
    if (counts.commands) pills.push(`${counts.commands} cmd${counts.commands === 1 ? '' : 's'}`);
    if (counts.mcp) pills.push(`${counts.mcp} mcp`);
  }
  return (
    <div
      className={`rounded-xl border bg-cream/60 p-3 flex flex-col gap-2 transition-colors ${
        plugin.enabled ? 'border-warm-gray hover:border-sage/30' : 'border-warm-gray/60 opacity-75'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-navy flex-1 truncate">{plugin.name}</span>
        {plugin.version !== null && (
          <span className="text-[10px] text-navy-light tabular-nums shrink-0">v{plugin.version}</span>
        )}
        <span
          className={
            plugin.enabled
              ? 'px-2 py-0.5 rounded-full text-[10px] font-medium bg-sage/20 text-sage shrink-0'
              : 'px-2 py-0.5 rounded-full text-[10px] font-medium bg-warm-gray text-navy-light shrink-0'
          }
        >
          {plugin.enabled ? 'enabled' : 'disabled'}
        </span>
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
          <span key={p} className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-navy/8 text-navy-light">
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CommandCenterTab() {
  // Store selectors
  const inventory = useClaudeStore((s) => s.inventory);
  const scanning = useClaudeStore((s) => s.scanning);
  const scanError = useClaudeStore((s) => s.scanError);
  const aiSummary = useClaudeStore((s) => s.aiSummary);
  const aiSummaryLoading = useClaudeStore((s) => s.aiSummaryLoading);
  const aiUnavailableReason = useClaudeStore((s) => s.aiUnavailableReason);
  const scanClaude = useClaudeStore((s) => s.scanClaude);
  const generateHealthSummary = useClaudeStore((s) => s.generateHealthSummary);

  const enrichments = useClaudeStore((s) => s.enrichments);
  const enrichLoading = useClaudeStore((s) => s.enrichLoading);
  const enrichProgress = useClaudeStore((s) => s.enrichProgress);
  const enrichUnavailableReason = useClaudeStore((s) => s.enrichUnavailableReason);

  const recommendations = useClaudeStore((s) => s.recommendations);
  const curateNarrative = useClaudeStore((s) => s.curateNarrative);
  const curateLoading = useClaudeStore((s) => s.curateLoading);
  const curateUnavailableReason = useClaudeStore((s) => s.curateUnavailableReason);
  const generateRecommendations = useClaudeStore((s) => s.generateRecommendations);

  const requestAskCommand = useViewStore((s) => s.requestAskCommand);

  const editorCommand = useBoardStore((s) => s.settings.editorCommand);
  const editorApp = useBoardStore((s) => s.settings.editorApp);

  // Local UI state: active sub-tab + per-sub-tab search/filter terms.
  const [subTab, setSubTab] = useState<ClaudeSubTab>('overview');
  const [detail, setDetail] = useState<ClaudeDetailEntity | null>(null);
  const [mcpSearch, setMcpSearch] = useState('');
  const [mcpScope, setMcpScope] = useState('all');
  const [mcpTransport, setMcpTransport] = useState('all');
  const [skillSearch, setSkillSearch] = useState('');
  const [skillSource, setSkillSource] = useState('all');
  const [agentSearch, setAgentSearch] = useState('');
  const [agentSource, setAgentSource] = useState('all');
  const [pluginSearch, setPluginSearch] = useState('');
  const [pluginFilter, setPluginFilter] = useState('all');

  // Lazy fresh scan on first mount
  useEffect(() => {
    void scanClaude();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazily compute recommendations the first time the Curate sub-tab opens.
  // Findings commit synchronously; the AI narrative is additive. Guard on
  // `recommendations === null` so re-opening doesn't recompute or re-hit the sidecar.
  useEffect(() => {
    if (subTab === 'recommendations' && inventory !== null && recommendations === null) {
      void generateRecommendations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, inventory]);

  // ---------------------------------------------------------------------------
  // Quick-action helpers
  // ---------------------------------------------------------------------------

  const handleQuickAction = (prompt: string) => {
    void (async () => {
      const home = await homeDir();
      const claudeDir = await join(home, '.claude');
      requestAskCommand(claudeDir, prompt);
    })();
  };

  const handleOpenSettings = () => {
    void (async () => {
      const home = await homeDir();
      const settingsPath = await join(home, '.claude', 'settings.json');
      void invoke('open_in_editor', {
        command: editorCommand,
        app: editorApp,
        path: settingsPath,
      });
    })();
  };

  // Quick actions, surfaced as compact icon+label buttons in the header bar.
  const quickActions = [
    { label: 'List my MCP servers', short: 'MCP', icon: Server, run: () => handleQuickAction('list my configured MCP servers') },
    { label: 'Summarize my hooks', short: 'Hooks', icon: Webhook, run: () => handleQuickAction('summarize my Claude Code hooks') },
    { label: 'Explain my skills', short: 'Skills', icon: Wrench, run: () => handleQuickAction('show me my installed skills and what they do') },
    { label: 'List my commands', short: 'Commands', icon: SquareTerminal, run: () => handleQuickAction('list my Claude Code slash commands') },
    { label: 'Open settings.json', short: 'Settings', icon: FileJson, run: handleOpenSettings },
  ];

  // ---------------------------------------------------------------------------
  // Derived data — computed only when an inventory is present.
  // ---------------------------------------------------------------------------

  // Skill source groups for the overview donut: aggregate by origin.
  const skillGroups = useMemo(
    () =>
      inventory === null
        ? []
        : groupBySource(inventory.skills).map(([label, list]) => ({
            label,
            value: list.length,
          })),
    [inventory],
  );

  // Distinct source values (for the skills/agents source filter dropdowns).
  const skillSources = useMemo(
    () =>
      inventory === null
        ? ['all']
        : ['all', ...groupBySource(inventory.skills).map(([s]) => s)],
    [inventory],
  );
  const agentSources = useMemo(
    () =>
      inventory === null
        ? ['all']
        : ['all', ...groupBySource(inventory.agents).map(([s]) => s)],
    [inventory],
  );

  // Filtered MCP servers (search + scope + transport).
  const filteredMcp = useMemo(() => {
    if (inventory === null) return [];
    const q = mcpSearch.trim().toLowerCase();
    return inventory.mcpServers.filter((srv) => {
      if (q.length > 0 && !srv.name.toLowerCase().includes(q)) return false;
      if (mcpScope !== 'all' && srv.scope !== mcpScope) return false;
      if (mcpTransport !== 'all' && srv.transport !== mcpTransport) return false;
      return true;
    });
  }, [inventory, mcpSearch, mcpScope, mcpTransport]);

  // Filtered skills (search + source).
  const filteredSkills = useMemo(() => {
    if (inventory === null) return [];
    const q = skillSearch.trim().toLowerCase();
    return inventory.skills.filter((skill) => {
      if (skillSource !== 'all' && skill.source !== skillSource) return false;
      if (q.length === 0) return true;
      return (
        skill.name.toLowerCase().includes(q) ||
        (skill.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [inventory, skillSearch, skillSource]);

  // Filtered agents (search + source).
  const filteredAgents = useMemo(() => {
    if (inventory === null) return [];
    const q = agentSearch.trim().toLowerCase();
    return inventory.agents.filter((agent) => {
      if (agentSource !== 'all' && agent.source !== agentSource) return false;
      if (q.length === 0) return true;
      return (
        agent.name.toLowerCase().includes(q) ||
        (agent.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [inventory, agentSearch, agentSource]);

  const enabledPlugins =
    inventory === null ? 0 : inventory.plugins.filter((p) => p.enabled).length;

  // Per-plugin content counts: how many skills/agents/commands/mcp each plugin
  // contributes, keyed by the source tag (= plugin name).
  const pluginCounts = useMemo(() => {
    const m: Record<string, { skills: number; agents: number; commands: number; mcp: number }> = {};
    if (inventory === null) return m;
    const bump = (src: string, key: 'skills' | 'agents' | 'commands' | 'mcp') => {
      (m[src] ??= { skills: 0, agents: 0, commands: 0, mcp: 0 })[key] += 1;
    };
    inventory.skills.forEach((s) => bump(s.source, 'skills'));
    inventory.agents.forEach((a) => bump(a.source, 'agents'));
    inventory.commands.forEach((c) => bump(c.source, 'commands'));
    inventory.mcpServers.forEach((s) => bump(s.source, 'mcp'));
    return m;
  }, [inventory]);

  // Filtered plugins (state filter + search).
  const filteredPlugins = useMemo(() => {
    if (inventory === null) return [];
    const q = pluginSearch.trim().toLowerCase();
    return inventory.plugins.filter((p) => {
      if (pluginFilter === 'enabled' && !p.enabled) return false;
      if (pluginFilter === 'disabled' && p.enabled) return false;
      if (q.length > 0) {
        const nameMatch = p.name.toLowerCase().includes(q);
        const descMatch = p.description !== null && p.description.toLowerCase().includes(q);
        if (!nameMatch && !descMatch) return false;
      }
      return true;
    });
  }, [inventory, pluginSearch, pluginFilter]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-warm-gray bg-cream/60">
        <h2 className="text-sm font-semibold text-navy">Command Center</h2>
        <div className="flex items-center gap-2">
          {scanning && (
            <span className="text-[11px] text-navy-light animate-pulse">
              Scanning&hellip;
            </span>
          )}
          {/* Quick actions — compact icon+label buttons that dispatch prompts to the Ask tab */}
          <div className="flex items-center gap-1">
            {quickActions.map((qa) => (
              <button
                key={qa.label}
                type="button"
                title={qa.label}
                aria-label={qa.label}
                onClick={qa.run}
                disabled={inventory === null}
                className="flex items-center gap-1 px-2 py-1 rounded-lg border border-warm-gray bg-cream/60 text-navy-light
                           hover:bg-cream hover:text-navy disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors cursor-pointer
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/50 focus-visible:ring-offset-1"
              >
                <qa.icon size={13} strokeWidth={1.75} />
                <span className="text-[11px] font-medium leading-none">{qa.short}</span>
              </button>
            ))}
          </div>
          <div className="h-5 w-px bg-warm-gray mx-0.5" aria-hidden="true" />
          <button
            type="button"
            title="Re-scan ~/.claude"
            onClick={() => void scanClaude({ force: true })}
            disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-warm-gray bg-cream text-xs text-navy
                       hover:bg-cream/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/50 focus-visible:ring-offset-1"
          >
            <RefreshCw size={12} strokeWidth={2} />
            Refresh
          </button>
          <button
            type="button"
            title="Generate AI health summary"
            onClick={() => void generateHealthSummary()}
            disabled={scanning || aiSummaryLoading || inventory === null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-warm-gray bg-cream text-xs text-navy
                       hover:bg-cream/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/50 focus-visible:ring-offset-1"
          >
            <Sparkles size={12} strokeWidth={2} />
            Health summary
          </button>
        </div>
      </div>

      {/* Scan-error strip */}
      {scanError !== null && (
        <div className="shrink-0 px-4 py-1.5 text-[11px] font-mono bg-terracotta/15 text-terracotta border-b border-terracotta/40">
          Scan error: {scanError}
        </div>
      )}

      {/* ── KPI row + sub-tab nav (only when inventory present) ── */}
      {inventory !== null && (
        <div className="shrink-0 border-b border-warm-gray bg-cream/60">
          <div className="px-4 pt-3 pb-2 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <KpiCard label="MCP" value={inventory.mcpServers.length} caption="UNIQUE" accent="sage" />
            <KpiCard label="Skills" value={inventory.skills.length} caption="INSTALLED" accent="tertiary" />
            <KpiCard label="Agents" value={inventory.agents.length} caption="LOCAL+PLUGIN" accent="navy" />
            <KpiCard label="Commands" value={inventory.commands.length} caption="SLASH" accent="sage" />
            <KpiCard label="Plugins" value={enabledPlugins} total={inventory.plugins.length} accent="tertiary" />
            <KpiCard label="Hooks" value={inventory.hooks.length} caption="CONFIGURED" accent="terracotta" />
            <KpiCard label="Sessions" value={inventory.sessions.length} caption="PROJECTS" accent="navy" />
          </div>
          <SubTabNav
            active={subTab}
            onChange={setSubTab}
            counts={{
              mcp: inventory.mcpServers.length,
              skills: inventory.skills.length,
              agents: inventory.agents.length,
              sessions: inventory.sessions.length,
              ...(recommendations !== null ? { recommendations: recommendations.length } : {}),
            }}
          />
        </div>
      )}

      {/* ── Body ────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-6">

        {/* Empty state */}
        {inventory === null && !scanning && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16">
            <p className="text-sm text-navy-light">No inventory yet.</p>
            <button
              type="button"
              onClick={() => void scanClaude()}
              className="px-4 py-2 rounded-xl bg-navy text-cream text-sm font-medium
                         hover:bg-navy/90 transition-colors cursor-pointer
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/50 focus-visible:ring-offset-1"
            >
              Scan ~/.claude
            </button>
          </div>
        )}

        {/* Loading placeholder */}
        {inventory === null && scanning && (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-sm text-navy-light animate-pulse">Scanning&hellip;</span>
          </div>
        )}

        {inventory !== null && (
          <>
            {/* ════════════════════════════════════════════════════════════
                OVERVIEW
               ════════════════════════════════════════════════════════════ */}
            {subTab === 'overview' && (
              <>
                {/* Skills donut */}
                <section>
                  <SectionHeader label="Skills by Source" />
                  <div className="rounded-xl border border-warm-gray bg-cream/60 p-4">
                    <SkillsDonut groups={skillGroups} />
                  </div>
                </section>

                {/* Hooks / Settings / Global Memory — 3-column grid on wide screens */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Hooks */}
                  {inventory.hooks.length > 0 && (
                    <section>
                      <SectionHeader label={`Hooks (${inventory.hooks.length})`} />
                      <div className="rounded-xl border border-warm-gray bg-cream/60 divide-y divide-warm-gray/50">
                        {inventory.hooks.map((hook, i) => (
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
                  )}

                  {/* Settings */}
                  {inventory.settings !== null && (
                    <section>
                      <SectionHeader label="Settings" />
                      <div className="rounded-xl border border-warm-gray bg-cream/60 divide-y divide-warm-gray/50">
                        {inventory.settings.model !== null && (
                          <div className="flex items-center gap-2 px-3 py-2">
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-light w-20 shrink-0">
                              Model
                            </span>
                            <span className="text-sm font-mono text-navy">{inventory.settings.model}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 px-3 py-2">
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-light w-20 shrink-0">
                            Allow
                          </span>
                          <span className="text-sm tabular-nums text-navy">
                            {inventory.settings.permissions.allow.length} rules
                          </span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-2">
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-light w-20 shrink-0">
                            Deny
                          </span>
                          <span className="text-sm tabular-nums text-navy">
                            {inventory.settings.permissions.deny.length} rules
                          </span>
                        </div>
                        {inventory.settings.envKeys.length > 0 && (
                          <div className="flex items-start gap-2 px-3 py-2">
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-light w-20 shrink-0 mt-0.5">
                              Env Keys
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {inventory.settings.envKeys.map((key) => (
                                <span
                                  key={key}
                                  className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-navy/8 text-navy-light"
                                >
                                  {key}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {/* Global Memory */}
                  {inventory.globalMemory !== null && (
                    <section>
                      <SectionHeader label="Global Memory (CLAUDE.md)" />
                      <div className="rounded-xl border border-warm-gray bg-cream/60 px-3 py-2 flex items-center gap-3">
                        <span
                          className={
                            inventory.globalMemory.present
                              ? 'px-2 py-0.5 rounded-full text-[10px] font-medium bg-sage/20 text-sage'
                              : 'px-2 py-0.5 rounded-full text-[10px] font-medium bg-warm-gray text-navy-light'
                          }
                        >
                          {inventory.globalMemory.present ? 'present' : 'absent'}
                        </span>
                        {inventory.globalMemory.present && (
                          <span className="text-xs text-navy-light tabular-nums">
                            {inventory.globalMemory.charCount.toLocaleString()} chars
                          </span>
                        )}
                      </div>
                    </section>
                  )}
                </div>

                {/* AI health panel */}
                {(aiSummary !== null || aiSummaryLoading || aiUnavailableReason !== null) && (
                  <section>
                    <SectionHeader label="AI Health Summary" />
                    <div className="rounded-xl border border-warm-gray bg-cream/60 px-4 py-3">
                      {aiSummaryLoading && (
                        <p className="text-sm text-navy-light animate-pulse">Generating summary&hellip;</p>
                      )}
                      {aiUnavailableReason !== null && !aiSummaryLoading && (
                        <p className="text-xs text-navy-light">{aiUnavailableReason}</p>
                      )}
                      {aiSummary !== null && !aiSummaryLoading && (
                        <div className="text-sm text-navy leading-relaxed">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={mdComponents}
                          >
                            {aiSummary}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* Enrichment unavailable note */}
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
                        onSearch={setPluginSearch}
                        placeholder="Search plugins…"
                        filters={[
                          {
                            key: 'state',
                            label: 'State',
                            options: ['all', 'enabled', 'disabled'],
                            value: pluginFilter,
                            onChange: setPluginFilter,
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
            )}

            {/* ════════════════════════════════════════════════════════════
                MCP
               ════════════════════════════════════════════════════════════ */}
            {subTab === 'mcp' && (
              <>
                <FilterBar
                  search={mcpSearch}
                  onSearch={setMcpSearch}
                  placeholder="Search MCP servers…"
                  filters={[
                    {
                      key: 'scope',
                      label: 'Scope',
                      options: ['all', 'global', 'project'],
                      value: mcpScope,
                      onChange: setMcpScope,
                    } satisfies FilterGroup,
                    {
                      key: 'transport',
                      label: 'Transport',
                      options: ['all', 'stdio', 'sse', 'http'],
                      value: mcpTransport,
                      onChange: setMcpTransport,
                    } satisfies FilterGroup,
                  ]}
                />
                {filteredMcp.length === 0 ? (
                  <p className="text-sm text-navy-light text-center py-8">No MCP servers match.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredMcp.map((srv, i) => (
                      <McpCard
                        key={`${srv.source}-${srv.name}-${i}`}
                        server={srv}
                        blurb={enrichments[`mcp:${srv.name}`]}
                        onOpen={() =>
                          setDetail({
                            kind: 'mcp',
                            name: srv.name,
                            server: srv,
                            blurb: enrichments[`mcp:${srv.name}`],
                          })
                        }
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ════════════════════════════════════════════════════════════
                SKILLS
               ════════════════════════════════════════════════════════════ */}
            {subTab === 'skills' && (
              <>
                <FilterBar
                  search={skillSearch}
                  onSearch={setSkillSearch}
                  placeholder="Search skills…"
                  filters={[
                    {
                      key: 'source',
                      label: 'Source',
                      options: skillSources,
                      value: skillSource,
                      onChange: setSkillSource,
                    } satisfies FilterGroup,
                  ]}
                />
                {filteredSkills.length === 0 ? (
                  <p className="text-sm text-navy-light text-center py-8">No skills match.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredSkills.map((skill, i) => (
                      <SkillCard
                        key={`${skill.path}-${i}`}
                        skill={skill}
                        onOpen={() =>
                          setDetail({
                            kind: 'skill',
                            name: skill.name,
                            path: skill.path,
                            description: skill.description,
                            source: skill.source,
                          })
                        }
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ════════════════════════════════════════════════════════════
                AGENTS + COMMANDS
               ════════════════════════════════════════════════════════════ */}
            {subTab === 'agents' && (
              <>
                <FilterBar
                  search={agentSearch}
                  onSearch={setAgentSearch}
                  placeholder="Search agents…"
                  filters={[
                    {
                      key: 'source',
                      label: 'Source',
                      options: agentSources,
                      value: agentSource,
                      onChange: setAgentSource,
                    } satisfies FilterGroup,
                  ]}
                />
                {filteredAgents.length === 0 ? (
                  <p className="text-sm text-navy-light text-center py-8">No agents match.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredAgents.map((agent, i) => (
                      <AgentCard
                        key={`${agent.path}-${i}`}
                        agent={agent}
                        onOpen={() =>
                          setDetail({
                            kind: 'agent',
                            name: agent.name,
                            path: agent.path,
                            description: agent.description,
                            source: agent.source,
                          })
                        }
                      />
                    ))}
                  </div>
                )}

                {/* Commands sub-section */}
                {inventory.commands.length > 0 && (
                  <section>
                    <SectionHeader label={`Commands (${inventory.commands.length})`} />
                    <GroupedList
                      items={inventory.commands}
                      keyFor={(cmd, i) => `${cmd.path}-${i}`}
                      renderItem={(cmd) => (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            setDetail({
                              kind: 'command',
                              name: cmd.name,
                              path: cmd.path,
                              description: cmd.description,
                              source: cmd.source,
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setDetail({
                                kind: 'command',
                                name: cmd.name,
                                path: cmd.path,
                                description: cmd.description,
                                source: cmd.source,
                              });
                            }
                          }}
                          className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-navy/[0.03]
                                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/50"
                        >
                          <span className="text-sm font-medium text-navy font-mono shrink-0">/{cmd.name}</span>
                          {cmd.description !== null && (
                            <span className="text-xs text-navy-light truncate">{cmd.description}</span>
                          )}
                        </div>
                      )}
                    />
                  </section>
                )}
              </>
            )}

            {/* ════════════════════════════════════════════════════════════
                SESSIONS
               ════════════════════════════════════════════════════════════ */}
            {subTab === 'sessions' && (
              <SessionsTable sessions={inventory.sessions} blurbs={enrichments} />
            )}

            {/* ════════════════════════════════════════════════════════════
                CURATE (Setup Curator recommendations)
               ════════════════════════════════════════════════════════════ */}
            {subTab === 'recommendations' && (
              <Recommendations
                findings={recommendations}
                narrative={curateNarrative}
                loading={curateLoading}
                unavailableReason={curateUnavailableReason}
                onRegenerate={() => void generateRecommendations()}
              />
            )}

            {/* Empty-config notice (shared across sub-tabs) */}
            {inventory.sessions.length === 0 && inventory.hooks.length === 0 &&
              inventory.skills.length === 0 && inventory.agents.length === 0 &&
              inventory.commands.length === 0 && inventory.mcpServers.length === 0 &&
              inventory.plugins.length === 0 && (
              <p className="text-sm text-navy-light text-center py-4">
                No Claude Code configuration found in ~/.claude.
              </p>
            )}

            {/* Non-fatal scan errors (shared across sub-tabs) */}
            {inventory.errors.length > 0 && (
              <section>
                <SectionHeader label="Scan Warnings" />
                <div className="rounded-xl border border-terracotta/30 bg-terracotta/8 px-3 py-2 flex flex-col gap-1">
                  {inventory.errors.map((err, i) => (
                    <p key={i} className="text-xs text-terracotta font-mono">{err}</p>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* ── Bottom enrichment progress bar (auto-shows while running) ── */}
      {enrichLoading && (
        <div className="shrink-0 border-t border-warm-gray bg-cream/80 px-4 py-2 flex items-center gap-3">
          <Sparkles size={13} strokeWidth={2} className="text-sage animate-pulse shrink-0" />
          <span className="text-[11px] text-navy-light shrink-0">
            Enriching context with on-device AI
            {enrichProgress !== null ? ` — ${enrichProgress.done}/${enrichProgress.total}` : '…'}
          </span>
          <div className="flex-1 h-1 rounded-full bg-navy/10 overflow-hidden">
            <div
              className="h-full bg-sage transition-all duration-300"
              style={{
                width:
                  enrichProgress !== null && enrichProgress.total > 0
                    ? `${(enrichProgress.done / enrichProgress.total) * 100}%`
                    : '15%',
              }}
            />
          </div>
        </div>
      )}

      {/* ── Detail modal (skill / agent / command / mcp) ── */}
      {detail !== null && <ClaudeDetail entity={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
