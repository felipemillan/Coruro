// CommandCenterTab.tsx — Claude Command Center full-tab component.
// Shows a scanned inventory of the user's ~/.claude setup: MCP servers,
// skills, agents, commands, plugins, hooks, settings, and session stats.
// An AI health panel renders a generated Markdown summary when available.
// Quick-action buttons dispatch natural-language prompts to the Ask tab.

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RefreshCw, Sparkles } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { homeDir, join } from '@tauri-apps/api/path';
import { useClaudeStore } from '../store/useClaudeStore';
import { useViewStore } from '../store/useViewStore';
import { useBoardStore } from '../store/useBoardStore';
import type { Components } from 'react-markdown';

// ---------------------------------------------------------------------------
// Markdown renderer components for the AI health panel (mirrors NotesTab style)
// ---------------------------------------------------------------------------

const mdComponents: Components = {
  p({ children }) {
    return <p className="mb-2 last:mb-0 leading-relaxed text-navy/90">{children}</p>;
  },
  li({ children }) {
    return <li className="mb-0.5 leading-snug">{children}</li>;
  },
  h1({ children }) {
    return (
      <h1 className="text-base font-bold text-navy mt-4 mb-2 pb-1 border-b border-warm-gray/50 first:mt-0">
        {children}
      </h1>
    );
  },
  h2({ children }) {
    return (
      <h2 className="text-sm font-semibold text-navy mt-4 mb-1.5 pb-0.5 border-b border-warm-gray/30 first:mt-0">
        {children}
      </h2>
    );
  },
  h3({ children }) {
    return (
      <h3 className="text-xs font-semibold text-navy/70 mt-3 mb-1 pl-2 border-l-2 border-sage/60 first:mt-0">
        {children}
      </h3>
    );
  },
  ul({ children }) {
    return (
      <ul className="list-disc list-outside ml-4 space-y-0.5 text-sm text-navy/85 mb-2">
        {children}
      </ul>
    );
  },
  ol({ children }) {
    return (
      <ol className="list-decimal list-outside ml-4 space-y-0.5 text-sm text-navy/85 mb-2">
        {children}
      </ol>
    );
  },
  code({ children }) {
    return (
      <code className="font-mono text-xs bg-navy/6 border border-navy/10 px-1 py-0.5 rounded">
        {children}
      </code>
    );
  },
  strong({ children }) {
    return <strong className="font-semibold text-navy">{children}</strong>;
  },
  hr() {
    return <hr className="border-warm-gray/30 my-3" />;
  },
};

// ---------------------------------------------------------------------------
// Local stat-grid (StatGrid visual idiom; not importing to avoid coupling)
// ---------------------------------------------------------------------------

interface LocalStat {
  label: string;
  value: string | number;
}

function MiniStatGrid({ stats }: { stats: LocalStat[] }) {
  return (
    <div className={`grid border border-navy/10 rounded-xl overflow-hidden`} style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}>
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={[
            'py-2 px-1 text-center bg-cream/60',
            i < stats.length - 1 ? 'border-r border-navy/10' : '',
          ].join(' ')}
        >
          <span className="block text-navy font-semibold text-sm leading-none tabular-nums">
            {s.value}
          </span>
          <span className="block text-navy-light text-[9px] font-bold tracking-wider mt-0.5 uppercase">
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header helper
// ---------------------------------------------------------------------------

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-navy-light mb-2">
      {label}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Chip helpers
// ---------------------------------------------------------------------------

function ScopeChip({ scope }: { scope: 'global' | 'project' }) {
  return (
    <span
      className={
        scope === 'global'
          ? 'px-2 py-0.5 rounded-full text-[10px] font-medium bg-sage/20 text-sage'
          : 'px-2 py-0.5 rounded-full text-[10px] font-medium bg-navy/10 text-navy'
      }
    >
      {scope}
    </span>
  );
}

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

  const requestAskCommand = useViewStore((s) => s.requestAskCommand);

  const editorCommand = useBoardStore((s) => s.settings.editorCommand);
  const editorApp = useBoardStore((s) => s.settings.editorApp);

  // Lazy fresh scan on first mount
  useEffect(() => {
    void scanClaude();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <button
            type="button"
            title="Re-scan ~/.claude"
            onClick={() => void scanClaude({ force: true })}
            disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-warm-gray bg-cream text-xs text-navy
                       hover:bg-cream/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
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
                       hover:bg-cream/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
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
                         hover:bg-navy/90 transition-colors cursor-pointer"
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
            {/* ── a. Summary stat grid ──────────────────── */}
            <section>
              <SectionHeader label="Overview" />
              <MiniStatGrid
                stats={[
                  { label: 'MCP Servers', value: inventory.mcpServers.length },
                  { label: 'Skills', value: inventory.skills.length },
                  { label: 'Agents', value: inventory.agents.length },
                  { label: 'Commands', value: inventory.commands.length },
                  { label: 'Plugins', value: inventory.plugins.length },
                  { label: 'Hooks', value: inventory.hooks.length },
                  { label: 'Sessions', value: inventory.sessions.length },
                ]}
              />
            </section>

            {/* ── b. Per-category sections ─────────────── */}

            {/* MCP Servers */}
            {inventory.mcpServers.length > 0 && (
              <section>
                <SectionHeader label={`MCP Servers (${inventory.mcpServers.length})`} />
                <GroupedList
                  items={inventory.mcpServers}
                  keyFor={(srv, i) => `${srv.source}-${srv.name}-${i}`}
                  renderItem={(srv) => (
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="text-sm font-medium text-navy flex-1 truncate">{srv.name}</span>
                      <ScopeChip scope={srv.scope} />
                      <span className="text-[10px] text-navy-light font-mono shrink-0">{srv.transport}</span>
                    </div>
                  )}
                />
              </section>
            )}

            {/* Skills */}
            {inventory.skills.length > 0 && (
              <section>
                <SectionHeader label={`Skills (${inventory.skills.length})`} />
                <GroupedList
                  items={inventory.skills}
                  keyFor={(skill, i) => `${skill.path}-${i}`}
                  renderItem={(skill) => (
                    <div className="flex items-start gap-2 px-3 py-2">
                      <span className="text-sm font-medium text-navy shrink-0">{skill.name}</span>
                      {skill.description !== null && (
                        <span className="text-xs text-navy-light truncate">{skill.description}</span>
                      )}
                    </div>
                  )}
                />
              </section>
            )}

            {/* Subagents */}
            {inventory.agents.length > 0 && (
              <section>
                <SectionHeader label={`Subagents (${inventory.agents.length})`} />
                <GroupedList
                  items={inventory.agents}
                  keyFor={(agent, i) => `${agent.path}-${i}`}
                  renderItem={(agent) => (
                    <div className="flex items-start gap-2 px-3 py-2">
                      <span className="text-sm font-medium text-navy shrink-0">{agent.name}</span>
                      {agent.description !== null && (
                        <span className="text-xs text-navy-light truncate">{agent.description}</span>
                      )}
                    </div>
                  )}
                />
              </section>
            )}

            {/* Commands */}
            {inventory.commands.length > 0 && (
              <section>
                <SectionHeader label={`Commands (${inventory.commands.length})`} />
                <GroupedList
                  items={inventory.commands}
                  keyFor={(cmd, i) => `${cmd.path}-${i}`}
                  renderItem={(cmd) => (
                    <div className="flex items-start gap-2 px-3 py-2">
                      <span className="text-sm font-medium text-navy font-mono shrink-0">/{cmd.name}</span>
                      {cmd.description !== null && (
                        <span className="text-xs text-navy-light truncate">{cmd.description}</span>
                      )}
                    </div>
                  )}
                />
              </section>
            )}

            {/* Plugins */}
            {inventory.plugins.length > 0 && (
              <section>
                <SectionHeader
                  label={`Plugins (${inventory.plugins.length} — ${
                    inventory.plugins.filter((p) => p.enabled).length
                  } on / ${inventory.plugins.filter((p) => !p.enabled).length} off)`}
                />
                <div className="rounded-xl border border-warm-gray bg-cream/60 divide-y divide-warm-gray/50">
                  {inventory.plugins.map((plugin, i) => (
                    <div key={`${plugin.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
                      <span className="text-sm font-medium text-navy flex-1 truncate">{plugin.name}</span>
                      {plugin.version !== null && (
                        <span className="text-[10px] text-navy-light tabular-nums shrink-0">
                          v{plugin.version}
                        </span>
                      )}
                      {plugin.marketplace !== null && (
                        <span className="text-[10px] text-navy-light font-mono truncate max-w-[160px]">
                          {plugin.marketplace}
                        </span>
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
                  ))}
                </div>
              </section>
            )}

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

            {/* Sessions */}
            {inventory.sessions.length === 0 && inventory.hooks.length === 0 &&
              inventory.skills.length === 0 && inventory.agents.length === 0 &&
              inventory.commands.length === 0 && inventory.mcpServers.length === 0 &&
              inventory.plugins.length === 0 && (
              <p className="text-sm text-navy-light text-center py-4">
                No Claude Code configuration found in ~/.claude.
              </p>
            )}

            {/* Sessions list */}
            {inventory.sessions.length > 0 && (
              <section>
                <SectionHeader label={`Project Sessions (${inventory.sessions.length})`} />
                <div className="rounded-xl border border-warm-gray bg-cream/60 divide-y divide-warm-gray/50">
                  {inventory.sessions.map((sess) => (
                    <div key={sess.projectSlug} className="flex items-center gap-2 px-3 py-2">
                      <span className="text-sm font-mono text-navy flex-1 truncate">{sess.projectSlug}</span>
                      <span className="text-xs text-navy-light tabular-nums shrink-0">
                        {sess.transcriptCount} transcript{sess.transcriptCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── c. AI health panel ──────────────────── */}
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

            {/* ── d. Quick actions ──────────────────────── */}
            <section>
              <SectionHeader label="Quick Actions" />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleQuickAction('list my configured MCP servers')}
                  className="px-3 py-1.5 rounded-lg border border-warm-gray bg-cream/60 text-xs text-navy
                             hover:bg-cream transition-colors cursor-pointer"
                >
                  List my MCP servers
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickAction('summarize my Claude Code hooks')}
                  className="px-3 py-1.5 rounded-lg border border-warm-gray bg-cream/60 text-xs text-navy
                             hover:bg-cream transition-colors cursor-pointer"
                >
                  Summarize my hooks
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickAction('show me my installed skills and what they do')}
                  className="px-3 py-1.5 rounded-lg border border-warm-gray bg-cream/60 text-xs text-navy
                             hover:bg-cream transition-colors cursor-pointer"
                >
                  Explain my skills
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickAction('list my Claude Code slash commands')}
                  className="px-3 py-1.5 rounded-lg border border-warm-gray bg-cream/60 text-xs text-navy
                             hover:bg-cream transition-colors cursor-pointer"
                >
                  List my commands
                </button>
                <button
                  type="button"
                  onClick={handleOpenSettings}
                  className="px-3 py-1.5 rounded-lg border border-warm-gray bg-cream/60 text-xs text-navy
                             hover:bg-cream transition-colors cursor-pointer"
                >
                  Open settings.json
                </button>
              </div>
            </section>

            {/* Non-fatal scan errors */}
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
    </div>
  );
}
