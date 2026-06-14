// McpSubTab.tsx — MCP servers sub-tab for the Command Center.

import type { ClaudeMcpServer } from '../../types';
import { FilterBar } from '../claude/FilterBar';
import type { FilterGroup } from '../claude/FilterBar';
import { McpCard } from '../claude/InventoryCards';
import type { ClaudeDetailEntity } from '../claude/ClaudeDetail';

interface McpSubTabProps {
  filteredMcp: ClaudeMcpServer[];
  enrichments: Record<string, string | undefined>;
  mcpSearch: string;
  onMcpSearch: (v: string) => void;
  mcpScope: string;
  onMcpScope: (v: string) => void;
  mcpTransport: string;
  onMcpTransport: (v: string) => void;
  onOpenDetail: (entity: ClaudeDetailEntity) => void;
}

export function McpSubTab({
  filteredMcp,
  enrichments,
  mcpSearch,
  onMcpSearch,
  mcpScope,
  onMcpScope,
  mcpTransport,
  onMcpTransport,
  onOpenDetail,
}: McpSubTabProps) {
  return (
    <>
      <FilterBar
        search={mcpSearch}
        onSearch={onMcpSearch}
        placeholder="Search MCP servers…"
        filters={[
          {
            key: 'scope',
            label: 'Scope',
            options: ['all', 'global', 'project'],
            value: mcpScope,
            onChange: onMcpScope,
          } satisfies FilterGroup,
          {
            key: 'transport',
            label: 'Transport',
            options: ['all', 'stdio', 'sse', 'http'],
            value: mcpTransport,
            onChange: onMcpTransport,
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
                onOpenDetail({
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
  );
}
