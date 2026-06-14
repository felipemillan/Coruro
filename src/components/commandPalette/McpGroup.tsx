/**
 * McpGroup.tsx — CommandGroup for MCP Servers in the CommandPalette.
 * MCP items are informational (no select action), with optional AI blurbs.
 */

import { CommandGroup, CommandItem } from 'cmdk';
import type { ClaudeMcpServer } from '../../types';
import { McpIcon } from './icons';

export interface McpGroupProps {
  servers: ClaudeMcpServer[];
  enrichments: Record<string, string>;
  enrichLoading: boolean;
  onClose(): void;
}

export function McpGroup({ servers, enrichments, enrichLoading, onClose }: McpGroupProps) {
  if (servers.length === 0) return null;

  const mcpBlurb = (server: ClaudeMcpServer): string | null =>
    enrichments[`mcp:${server.name}`] ?? null;

  return (
    <CommandGroup heading="MCP Servers">
      {servers.map((server) => {
        const blurb = mcpBlurb(server);
        const hasBlurb = blurb !== null;
        const transportLabel = server.transport !== 'unknown' ? server.transport : '';
        const scopeLabel = server.scope === 'project' ? 'project' : '';
        return (
          <CommandItem
            key={`${server.scope}:${server.name}`}
            value={`mcp ${server.name} ${server.transport} ${blurb ?? ''}`}
            onSelect={() => {
              // MCP items are informational — just close the palette.
              onClose();
            }}
            style={{ gap: 8, alignItems: 'flex-start', opacity: 0.85 }}
          >
            <McpIcon />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    color: 'var(--color-on-surface)',
                  }}
                >
                  {server.name}
                </span>
                {transportLabel && (
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--color-on-surface-variant)',
                      fontFamily: '"SFMono-Regular", ui-monospace, Menlo, monospace',
                    }}
                  >
                    {transportLabel}
                  </span>
                )}
              </div>
              {hasBlurb ? (
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--color-on-surface-variant)',
                    lineHeight: 1.4,
                  }}
                >
                  {blurb}
                </span>
              ) : enrichLoading ? (
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--color-outline)',
                    fontStyle: 'italic',
                  }}
                >
                  Loading AI descriptions…
                </span>
              ) : server.packageHint ? (
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--color-on-surface-variant)',
                    fontFamily: '"SFMono-Regular", ui-monospace, Menlo, monospace',
                  }}
                >
                  {server.packageHint}
                </span>
              ) : null}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 4,
                flexShrink: 0,
                alignSelf: 'center',
              }}
            >
              {scopeLabel && (
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--color-on-surface-variant)',
                    background: 'var(--color-surface-container-high)',
                    padding: '1px 6px',
                    borderRadius: 99,
                  }}
                >
                  {scopeLabel}
                </span>
              )}
              {server.source !== 'user' && (
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--color-on-surface-variant)',
                    background: 'var(--color-surface-container-high)',
                    padding: '1px 6px',
                    borderRadius: 99,
                  }}
                >
                  {server.source}
                </span>
              )}
            </div>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
