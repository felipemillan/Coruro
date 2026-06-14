// AgentsSubTab.tsx — Agents + Commands sub-tab for the Command Center.

import type { ClaudeAgent, ClaudeCommand } from '../../types';
import { FilterBar } from '../claude/FilterBar';
import type { FilterGroup } from '../claude/FilterBar';
import { AgentCard } from '../claude/InventoryCards';
import { SectionHeader } from '../claude/markdownComponents';
import { GroupedList } from './GroupedList';
import type { ClaudeDetailEntity } from '../claude/ClaudeDetail';

interface AgentsSubTabProps {
  filteredAgents: ClaudeAgent[];
  agentSources: string[];
  agentSearch: string;
  onAgentSearch: (v: string) => void;
  agentSource: string;
  onAgentSource: (v: string) => void;
  commands: ClaudeCommand[];
  onOpenDetail: (entity: ClaudeDetailEntity) => void;
}

export function AgentsSubTab({
  filteredAgents,
  agentSources,
  agentSearch,
  onAgentSearch,
  agentSource,
  onAgentSource,
  commands,
  onOpenDetail,
}: AgentsSubTabProps) {
  return (
    <>
      <FilterBar
        search={agentSearch}
        onSearch={onAgentSearch}
        placeholder="Search agents…"
        filters={[
          {
            key: 'source',
            label: 'Source',
            options: agentSources,
            value: agentSource,
            onChange: onAgentSource,
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
                onOpenDetail({
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
      {commands.length > 0 && (
        <section>
          <SectionHeader label={`Commands (${commands.length})`} />
          <GroupedList
            items={commands}
            keyFor={(cmd, i) => `${cmd.path}-${i}`}
            renderItem={(cmd) => (
              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  onOpenDetail({
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
                    onOpenDetail({
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
                <span className="text-sm font-medium text-navy font-mono shrink-0">
                  /{cmd.name}
                </span>
                {cmd.description !== null && (
                  <span className="text-xs text-navy-light truncate">{cmd.description}</span>
                )}
              </div>
            )}
          />
        </section>
      )}
    </>
  );
}
