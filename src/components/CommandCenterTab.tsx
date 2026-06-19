// CommandCenterTab.tsx — Claude Command Center full-tab dashboard.
// A sub-tabbed view over the scanned ~/.claude inventory: MCP servers, skills,
// agents/commands, plugins, hooks, settings, and project sessions. KPI cards
// headline the counts; a SubTabNav switches between focused sub-views. On-device
// AI enrichment adds short, clearly-labelled blurbs to MCP cards and sessions.
// An AI health panel renders a generated Markdown summary when available, and
// quick-action buttons dispatch natural-language prompts to the Ask tab.

import { useEffect, useMemo, useState } from 'react';
import { Server, Webhook, Wrench, SquareTerminal, FileJson } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { homeDir, join } from '@tauri-apps/api/path';
import { useClaudeStore } from '../store/useClaudeStore';
import { useViewStore } from '../store/useViewStore';
import { useBoardStore } from '../store/useBoardStore';
import { KpiCard } from './claude/KpiCard';
import { SubTabNav } from './claude/SubTabNav';
import type { ClaudeSubTab } from './claude/SubTabNav';
import { SessionsTable } from './claude/SessionsTable';
import { ClaudeDetail } from './claude/ClaudeDetail';
import type { ClaudeDetailEntity } from './claude/ClaudeDetail';
import { Recommendations } from './claude/Recommendations';
import { SectionHeader } from './claude/markdownComponents';
import { groupBySource } from './commandCenter/GroupedList';
import { OverviewSubTab } from './commandCenter/OverviewSubTab';
import { McpSubTab } from './commandCenter/McpSubTab';
import { SkillsSubTab } from './commandCenter/SkillsSubTab';
import { AgentsSubTab } from './commandCenter/AgentsSubTab';
import { CommandCenterHeader } from './commandCenter/CommandCenterHeader';
import { EnrichmentBar } from './commandCenter/EnrichmentBar';

export function CommandCenterTab() {
  const inventory = useClaudeStore((s) => s.inventory);
  const scanning = useClaudeStore((s) => s.scanning);
  const scanError = useClaudeStore((s) => s.scanError);
  const scanClaude = useClaudeStore((s) => s.scanClaude);

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

  useEffect(() => {
    void scanClaude();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      void invoke('open_in_editor', { command: editorCommand, app: editorApp, path: settingsPath });
    })();
  };

  const quickActions = [
    {
      label: 'List my MCP servers',
      short: 'MCP',
      icon: Server,
      run: () => handleQuickAction('list my configured MCP servers'),
    },
    {
      label: 'Summarize my hooks',
      short: 'Hooks',
      icon: Webhook,
      run: () => handleQuickAction('summarize my Claude Code hooks'),
    },
    {
      label: 'Explain my skills',
      short: 'Skills',
      icon: Wrench,
      run: () => handleQuickAction('show me my installed skills and what they do'),
    },
    {
      label: 'List my commands',
      short: 'Commands',
      icon: SquareTerminal,
      run: () => handleQuickAction('list my Claude Code slash commands'),
    },
    { label: 'Open settings.json', short: 'Settings', icon: FileJson, run: handleOpenSettings },
  ];

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const skillGroups = useMemo(
    () =>
      inventory === null
        ? []
        : groupBySource(inventory.skills).map(([label, list]) => ({ label, value: list.length })),
    [inventory],
  );
  const skillSources = useMemo(
    () =>
      inventory === null ? ['all'] : ['all', ...groupBySource(inventory.skills).map(([s]) => s)],
    [inventory],
  );
  const agentSources = useMemo(
    () =>
      inventory === null ? ['all'] : ['all', ...groupBySource(inventory.agents).map(([s]) => s)],
    [inventory],
  );
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
  const enabledPlugins = inventory === null ? 0 : inventory.plugins.filter((p) => p.enabled).length;
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
      <CommandCenterHeader
        scanning={scanning}
        inventoryLoaded={inventory !== null}
        quickActions={quickActions}
        onRefresh={() => void scanClaude({ force: true })}
      />

      {scanError !== null && (
        <div className="shrink-0 px-4 py-1.5 text-[11px] font-mono bg-terracotta/15 text-terracotta border-b border-terracotta/40">
          Scan error: {scanError}
        </div>
      )}

      {inventory !== null && (
        <div className="shrink-0 border-b border-warm-gray bg-cream/60">
          <div className="px-4 pt-3 pb-2 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <KpiCard
              label="MCP"
              value={inventory.mcpServers.length}
              caption="UNIQUE"
              accent="sage"
            />
            <KpiCard
              label="Skills"
              value={inventory.skills.length}
              caption="INSTALLED"
              accent="tertiary"
            />
            <KpiCard
              label="Agents"
              value={inventory.agents.length}
              caption="LOCAL+PLUGIN"
              accent="navy"
            />
            <KpiCard
              label="Commands"
              value={inventory.commands.length}
              caption="SLASH"
              accent="sage"
            />
            <KpiCard
              label="Plugins"
              value={enabledPlugins}
              total={inventory.plugins.length}
              accent="tertiary"
            />
            <KpiCard
              label="Hooks"
              value={inventory.hooks.length}
              caption="CONFIGURED"
              accent="terracotta"
            />
            <KpiCard
              label="Sessions"
              value={inventory.sessions.length}
              caption="PROJECTS"
              accent="navy"
            />
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

      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-6">
        {inventory === null && !scanning && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16">
            <p className="text-sm text-navy-light">No inventory yet.</p>
            <button
              type="button"
              onClick={() => void scanClaude()}
              className="nb-btn px-4 py-2 bg-navy text-cream text-sm font-medium hover:bg-navy/90 transition-colors cursor-pointer"
            >
              Scan ~/.claude
            </button>
          </div>
        )}

        {inventory === null && scanning && (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-sm text-navy-light animate-pulse">Scanning&hellip;</span>
          </div>
        )}

        {inventory !== null && (
          <>
            {subTab === 'overview' && (
              <OverviewSubTab
                inventory={inventory}
                skillGroups={skillGroups}
                enabledPlugins={enabledPlugins}
                filteredPlugins={filteredPlugins}
                pluginCounts={pluginCounts}
                pluginSearch={pluginSearch}
                onPluginSearch={setPluginSearch}
                pluginFilter={pluginFilter}
                onPluginFilter={setPluginFilter}
                enrichUnavailableReason={enrichUnavailableReason}
              />
            )}
            {subTab === 'mcp' && (
              <McpSubTab
                filteredMcp={filteredMcp}
                enrichments={enrichments}
                mcpSearch={mcpSearch}
                onMcpSearch={setMcpSearch}
                mcpScope={mcpScope}
                onMcpScope={setMcpScope}
                mcpTransport={mcpTransport}
                onMcpTransport={setMcpTransport}
                onOpenDetail={setDetail}
              />
            )}
            {subTab === 'skills' && (
              <SkillsSubTab
                filteredSkills={filteredSkills}
                skillSources={skillSources}
                skillSearch={skillSearch}
                onSkillSearch={setSkillSearch}
                skillSource={skillSource}
                onSkillSource={setSkillSource}
                onOpenDetail={setDetail}
              />
            )}
            {subTab === 'agents' && (
              <AgentsSubTab
                filteredAgents={filteredAgents}
                agentSources={agentSources}
                agentSearch={agentSearch}
                onAgentSearch={setAgentSearch}
                agentSource={agentSource}
                onAgentSource={setAgentSource}
                commands={inventory.commands}
                onOpenDetail={setDetail}
              />
            )}
            {subTab === 'sessions' && (
              <SessionsTable sessions={inventory.sessions} blurbs={enrichments} />
            )}
            {subTab === 'recommendations' && (
              <Recommendations
                findings={recommendations}
                narrative={curateNarrative}
                loading={curateLoading}
                unavailableReason={curateUnavailableReason}
                onRegenerate={() => void generateRecommendations()}
              />
            )}

            {inventory.sessions.length === 0 &&
              inventory.hooks.length === 0 &&
              inventory.skills.length === 0 &&
              inventory.agents.length === 0 &&
              inventory.commands.length === 0 &&
              inventory.mcpServers.length === 0 &&
              inventory.plugins.length === 0 && (
                <p className="text-sm text-navy-light text-center py-4">
                  No Claude Code configuration found in ~/.claude.
                </p>
              )}

            {inventory.errors.length > 0 && (
              <section>
                <SectionHeader label="Scan Warnings" />
                <div className="nb-card-sm px-3 py-2 flex flex-col gap-1 border-terracotta/30 bg-terracotta/8">
                  {inventory.errors.map((err, i) => (
                    <p key={i} className="text-xs text-terracotta font-mono">
                      {err}
                    </p>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {enrichLoading && <EnrichmentBar enrichProgress={enrichProgress} />}

      {detail !== null && <ClaudeDetail entity={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
