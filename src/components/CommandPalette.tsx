/**
 * CommandPalette.tsx — Global command palette for the Coruro app.
 *
 * Surfaces Claude Code inventory items (skills, agents, commands, MCP servers)
 * in a searchable cmdk dialog. Enrichment blurbs from the on-device AI model
 * are shown when available; falls back to the item's own description field.
 *
 * Enrichment ids used:
 *   - MCP servers: "mcp:<server.name>"   (from claudeEnrich.ts)
 *   - Skills, agents, commands: no enrichment ids exist yet — description shown.
 */

import React, { useEffect } from 'react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from 'cmdk';
import { useClaudeStore } from '../store/useClaudeStore';
import type { ClaudeSkill, ClaudeAgent, ClaudeCommand } from '../types';
import { SkillIcon, AgentIcon, CommandIcon } from './commandPalette/icons';
import { skillInvocation, agentInvocation, commandInvocation } from './commandPalette/helpers';
import { ItemLabel } from './commandPalette/ItemLabel';
import { McpGroup } from './commandPalette/McpGroup';

// ── Props ───────────────────────────────────────────────────────────────────

export interface CommandPaletteProps {
  open: boolean;
  onClose(): void;
  repoPath: string;
  onSelect(command: string): void;
}

// ── Main Component ──────────────────────────────────────────────────────────

export function CommandPalette({ open, onClose, onSelect }: CommandPaletteProps) {
  const inventory = useClaudeStore((s) => s.inventory);
  const enrichments = useClaudeStore((s) => s.enrichments);
  const enrichLoading = useClaudeStore((s) => s.enrichLoading);
  const scanClaude = useClaudeStore((s) => s.scanClaude);

  // Trigger a scan on mount if inventory is absent (palette opened cold).
  useEffect(() => {
    if (inventory === null) {
      void scanClaude();
    }
  }, [inventory, scanClaude]);

  const skills: ClaudeSkill[] = inventory?.skills ?? [];
  const agents: ClaudeAgent[] = inventory?.agents ?? [];
  const commands: ClaudeCommand[] = inventory?.commands ?? [];
  const mcpServers = inventory?.mcpServers ?? [];

  const hasAnyItems =
    skills.length > 0 || agents.length > 0 || commands.length > 0 || mcpServers.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen) onClose();
      }}
    >
      <Command label="Command palette">
        <div data-cmdk-input-wrapper="">
          <svg
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            aria-hidden="true"
            style={
              { color: 'var(--color-on-surface-variant)', flexShrink: 0 } as React.CSSProperties
            }
          >
            <path
              d="M10 6.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM9.3 10l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <CommandInput placeholder="Search skills, agents, commands, MCPs…" />
        </div>

        <CommandList>
          {!hasAnyItems && inventory !== null && (
            <CommandEmpty>No items found in your Claude setup.</CommandEmpty>
          )}
          {inventory === null && <CommandEmpty>Scanning Claude setup…</CommandEmpty>}

          {/* ── Skills ─────────────────────────────────────────────────────── */}
          {skills.length > 0 && (
            <CommandGroup heading="Skills">
              {skills.map((skill) => {
                const inv = skillInvocation(skill);
                const blurb = skill.description;
                return (
                  <CommandItem
                    key={skill.path}
                    value={`skill ${skill.name} ${inv} ${skill.description ?? ''}`}
                    onSelect={() => {
                      onSelect(inv);
                      onClose();
                    }}
                    style={{ gap: 8, alignItems: 'flex-start' }}
                  >
                    <SkillIcon />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ItemLabel
                        name={skill.name}
                        blurb={blurb}
                        loadingBlurb={false}
                        invocation={inv}
                      />
                    </div>
                    {skill.source !== 'local' && (
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--color-primary)',
                          background: 'var(--color-primary-container)',
                          padding: '1px 6px',
                          borderRadius: 99,
                          flexShrink: 0,
                          alignSelf: 'center',
                        }}
                      >
                        {skill.source}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {skills.length > 0 && agents.length > 0 && <CommandSeparator />}

          {/* ── Agents ─────────────────────────────────────────────────────── */}
          {agents.length > 0 && (
            <CommandGroup heading="Agents">
              {agents.map((agent) => {
                const inv = agentInvocation(agent);
                const blurb = agent.description;
                return (
                  <CommandItem
                    key={agent.path}
                    value={`agent ${agent.name} ${inv} ${agent.description ?? ''}`}
                    onSelect={() => {
                      onSelect(inv);
                      onClose();
                    }}
                    style={{ gap: 8, alignItems: 'flex-start' }}
                  >
                    <AgentIcon />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ItemLabel
                        name={agent.name}
                        blurb={blurb}
                        loadingBlurb={false}
                        invocation={inv}
                      />
                    </div>
                    {agent.source !== 'local' && (
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--color-secondary)',
                          background: 'var(--color-secondary-container)',
                          padding: '1px 6px',
                          borderRadius: 99,
                          flexShrink: 0,
                          alignSelf: 'center',
                        }}
                      >
                        {agent.source}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {agents.length > 0 && commands.length > 0 && <CommandSeparator />}

          {/* ── Commands ───────────────────────────────────────────────────── */}
          {commands.length > 0 && (
            <CommandGroup heading="Commands">
              {commands.map((cmd) => {
                const inv = commandInvocation(cmd);
                const blurb = cmd.description;
                return (
                  <CommandItem
                    key={cmd.path}
                    value={`command ${cmd.name} ${inv} ${cmd.description ?? ''}`}
                    onSelect={() => {
                      onSelect(inv);
                      onClose();
                    }}
                    style={{ gap: 8, alignItems: 'flex-start' }}
                  >
                    <CommandIcon />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ItemLabel
                        name={cmd.name}
                        blurb={blurb}
                        loadingBlurb={false}
                        invocation={inv}
                      />
                    </div>
                    {cmd.source !== 'local' && (
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--color-tertiary)',
                          background: 'var(--color-tertiary-container)',
                          padding: '1px 6px',
                          borderRadius: 99,
                          flexShrink: 0,
                          alignSelf: 'center',
                        }}
                      >
                        {cmd.source}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {commands.length > 0 && mcpServers.length > 0 && <CommandSeparator />}

          {/* ── MCP Servers ────────────────────────────────────────────────── */}
          <McpGroup
            servers={mcpServers}
            enrichments={enrichments}
            enrichLoading={enrichLoading}
            onClose={onClose}
          />
        </CommandList>

        {/* Footer hint */}
        <div
          style={{
            padding: '8px 14px',
            borderTop: '1px solid var(--color-outline-variant)',
            display: 'flex',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--color-on-surface-variant)' }}>
            <kbd
              style={{
                display: 'inline-block',
                padding: '1px 5px',
                borderRadius: 4,
                border: '1px solid var(--color-outline-variant)',
                fontSize: 10,
                fontFamily: 'inherit',
                color: 'var(--color-on-surface-variant)',
                marginRight: 4,
              }}
            >
              ↵
            </kbd>
            select
          </span>
          <span style={{ fontSize: 11, color: 'var(--color-on-surface-variant)' }}>
            <kbd
              style={{
                display: 'inline-block',
                padding: '1px 5px',
                borderRadius: 4,
                border: '1px solid var(--color-outline-variant)',
                fontSize: 10,
                fontFamily: 'inherit',
                color: 'var(--color-on-surface-variant)',
                marginRight: 4,
              }}
            >
              esc
            </kbd>
            close
          </span>
          {enrichLoading && (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                color: 'var(--color-outline)',
                fontStyle: 'italic',
              }}
            >
              Enriching with AI…
            </span>
          )}
        </div>
      </Command>
    </CommandDialog>
  );
}
