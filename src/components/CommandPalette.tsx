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
import type { ClaudeSkill, ClaudeAgent, ClaudeCommand, ClaudeMcpServer } from '../types';

// ── Icons (lightweight inline SVGs — avoids importing all of lucide) ────────

function SkillIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, color: 'var(--color-primary)', marginTop: 2 }}
    >
      <path
        d="M8 1L9.8 5.8L15 6.3L11.2 9.7L12.4 15L8 12.4L3.6 15L4.8 9.7L1 6.3L6.2 5.8L8 1Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, color: 'var(--color-secondary)', marginTop: 2 }}
    >
      <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CommandIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, color: 'var(--color-tertiary)', marginTop: 2 }}
    >
      <path d="M4 3h8M4 8h8M4 13h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function McpIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, color: 'var(--color-outline)', marginTop: 2 }}
    >
      <rect x="2" y="2" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="2" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

// ── Props ───────────────────────────────────────────────────────────────────

export interface CommandPaletteProps {
  open: boolean;
  onClose(): void;
  repoPath: string;
  onSelect(command: string): void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Derives the slash-invocation string for a skill. */
function skillInvocation(skill: ClaudeSkill): string {
  // Skills are invoked as /skill-name or /plugin:skill-name.
  // `dirName` is the canonical directory identifier (e.g. "caveman", "pr-review").
  const prefix =
    skill.source !== 'local' ? `/${skill.source}:${skill.dirName}` : `/${skill.dirName}`;
  return prefix;
}

/** Derives the slash-invocation string for an agent. */
function agentInvocation(agent: ClaudeAgent): string {
  // Agents are subagent types; use @source:name or just the file stem.
  const stem = agent.fileName.replace(/\.md$/i, '');
  return agent.source !== 'local' ? `@${agent.source}:${stem}` : `@${stem}`;
}

/** Derives the slash-invocation string for a command. */
function commandInvocation(cmd: ClaudeCommand): string {
  return `/${cmd.name}`;
}

// ── Sub-components ──────────────────────────────────────────────────────────

interface ItemLabelProps {
  name: string;
  blurb: string | null;
  loadingBlurb: boolean;
  invocation: string;
}

function ItemLabel({ name, blurb, loadingBlurb, invocation }: ItemLabelProps) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: 'var(--color-on-surface)',
          }}
        >
          {name}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-on-surface-variant)',
            fontFamily: '"SFMono-Regular", ui-monospace, Menlo, monospace',
          }}
        >
          {invocation}
        </span>
      </div>
      {blurb ? (
        <span
          style={{
            fontSize: 12,
            color: 'var(--color-on-surface-variant)',
            lineHeight: 1.4,
          }}
        >
          {blurb}
        </span>
      ) : loadingBlurb ? (
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-outline)',
            fontStyle: 'italic',
          }}
        >
          Loading AI description…
        </span>
      ) : null}
    </>
  );
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
  const mcpServers: ClaudeMcpServer[] = inventory?.mcpServers ?? [];

  // MCP blurbs are keyed by "mcp:<server.name>" in the enrichments record.
  const mcpBlurb = (server: ClaudeMcpServer): string | null =>
    enrichments[`mcp:${server.name}`] ?? null;

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
                // Skills don't currently have enrichment blurbs — use description.
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

          {/* ── MCP Servers (reference display; no select action) ──────────── */}
          {mcpServers.length > 0 && (
            <CommandGroup heading="MCP Servers">
              {mcpServers.map((server) => {
                const blurb = mcpBlurb(server);
                const hasBlurb = blurb !== null;
                // MCP servers are reference items — no invocation string, no onSelect
                // action that makes sense from the palette. We still register onSelect
                // so cmdk doesn't treat the item as disabled, but immediately close.
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
          )}
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
