// InventoryCards.tsx — Card components for the Claude Command Center inventory grids.
//
// Three exported card components, each targeting one inventory category:
//   McpCard   — one MCP server entry (scope / transport chips; optional AI blurb)
//   SkillCard — one skill (real frontmatter description; no AI blurb)
//   AgentCard — one subagent (real frontmatter description; no AI blurb)
//
// Palette follows the Coruro warm theme: cream/warm-gray backgrounds, navy
// text, sage accent for global scope, tertiary tint for transport, dusty-pink
// for AI blurb pill. Secret hygiene: no raw command or URL is rendered.

import type { KeyboardEvent } from 'react';
import type { ClaudeAgent, ClaudeMcpServer, ClaudeSkill } from '../../types';

// ---------------------------------------------------------------------------
// Shared chip primitives (local scope; not exported to avoid coupling)
// ---------------------------------------------------------------------------

/**
 * Chip for MCP scope — sage tint for 'global', navy tint for 'project'.
 */
function ScopeChip({ scope }: { scope: 'global' | 'project' }) {
  return (
    <span
      className={
        scope === 'global'
          ? 'nb-chip px-2 py-0.5 text-[10px] font-medium bg-sage/20 text-sage shrink-0'
          : 'nb-chip px-2 py-0.5 text-[10px] font-medium bg-navy/10 text-navy shrink-0'
      }
    >
      {scope}
    </span>
  );
}

/**
 * Chip for MCP transport — tertiary tint (dusty-pink cool accent).
 */
function TransportChip({ transport }: { transport: string }) {
  return (
    <span className="nb-chip px-2 py-0.5 text-[10px] font-medium bg-tertiary/20 text-tertiary shrink-0">
      {transport}
    </span>
  );
}

/**
 * Chip for item origin source — navy/8 neutral tone.
 */
function SourceChip({ source }: { source: string }) {
  return (
    <span className="nb-chip px-2 py-0.5 text-[10px] font-medium bg-navy/8 text-navy-light shrink-0">
      {source}
    </span>
  );
}

/**
 * Pill that labels machine-generated content — clearly marks the text as AI,
 * never authoritative. Uses a tertiary/sage tint per spec.
 */
function AiPill() {
  return (
    <span className="nb-chip inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-tertiary/20 text-tertiary shrink-0 leading-none">
      AI
    </span>
  );
}

// ---------------------------------------------------------------------------
// McpCard
// ---------------------------------------------------------------------------

export interface McpCardProps {
  server: ClaudeMcpServer;
  /**
   * Optional AI-generated blurb for this MCP server. When present it is
   * shown as muted helper text with a clearly labelled "AI" pill so it is
   * never mistaken for authoritative documentation.
   */
  blurb?: string;
  /** Opens the detail modal for this entry. */
  onOpen?: () => void;
}

/** Shared props for a card that opens a detail modal on click. */
const cardClickable =
  'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/50';

/** Keyboard handler: Enter/Space activate the card. */
function onCardKey(e: KeyboardEvent, onOpen?: () => void) {
  if (onOpen && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    onOpen();
  }
}

/**
 * Derive a safe display string from an MCP server entry for the footer row.
 * - If a URL is present: return only the host (never the full URL).
 * - If transport is stdio and no URL: return the literal string 'stdio'.
 * - Otherwise: null (nothing to show).
 *
 * Command strings are intentionally never exposed (secret hygiene).
 */
function mcpFooterHint(server: ClaudeMcpServer): string | null {
  if (server.url != null && server.url.length > 0) {
    try {
      return new URL(server.url).host;
    } catch {
      return null;
    }
  }
  if (server.transport === 'stdio') return 'stdio';
  return null;
}

/**
 * McpCard — inventory card for one MCP server entry.
 *
 * Renders the server name in monospace bold, a chip row showing scope,
 * transport, and source origin, an optional footer hint (url host or 'stdio'),
 * and an optional AI blurb. Raw command strings and full URLs are never shown
 * (secret hygiene).
 *
 * @example
 * <McpCard server={srv} blurb="Connects to your PostHog project for analytics queries." />
 */
export function McpCard({ server, blurb, onOpen }: McpCardProps) {
  const footerHint = mcpFooterHint(server);

  return (
    <article
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => onCardKey(e, onOpen)}
      className={`nb-card-sm p-3 flex flex-col gap-2 hover:border-sage/30 transition-colors duration-150 ${onOpen ? cardClickable : ''}`}
    >
      {/* Title row: name (truncated) + scope chip */}
      <div className="flex items-center gap-2 min-w-0">
        <p className="font-mono font-bold text-sm text-navy leading-snug truncate flex-1 min-w-0">
          {server.name}
        </p>
        <ScopeChip scope={server.scope} />
      </div>

      {/* Chips row: transport + source */}
      <div className="flex flex-wrap items-center gap-1">
        <TransportChip transport={server.transport} />
        <SourceChip source={server.source} />
      </div>

      {/* AI blurb — only when provided; always labelled */}
      {blurb !== undefined && blurb.length > 0 && (
        <div className="flex items-start gap-1.5">
          <AiPill />
          <p className="text-xs text-navy-light leading-snug">{blurb}</p>
        </div>
      )}

      {/* Footer meta row: url host or stdio indicator */}
      {footerHint !== null && (
        <div className="flex items-center gap-1.5 mt-auto pt-1 border-t border-warm-gray/40">
          <span className="font-mono text-[10px] text-navy-light truncate">{footerHint}</span>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// SkillCard
// ---------------------------------------------------------------------------

export interface SkillCardProps {
  skill: ClaudeSkill;
  onOpen?: () => void;
}

/**
 * SkillCard — inventory card for one installed skill.
 *
 * Shows the skill name, source chip, and the real frontmatter description
 * (skill.description). No AI blurb is shown here — descriptions come from
 * verified SKILL.md frontmatter and are treated as authoritative.
 *
 * @example
 * <SkillCard skill={skill} />
 */
export function SkillCard({ skill, onOpen }: SkillCardProps) {
  return (
    <article
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => onCardKey(e, onOpen)}
      className={`nb-card-sm p-3 flex flex-col gap-2 hover:border-sage/30 transition-colors duration-150 ${onOpen ? cardClickable : ''}`}
    >
      {/* Name + source chip on same row */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-navy leading-snug break-words min-w-0">
          {skill.name}
        </p>
        <SourceChip source={skill.source} />
      </div>

      {/* Real frontmatter description */}
      {skill.description !== null && (
        <p className="text-xs text-navy-light leading-snug">{skill.description}</p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// AgentCard
// ---------------------------------------------------------------------------

export interface AgentCardProps {
  agent: ClaudeAgent;
  onOpen?: () => void;
}

/**
 * AgentCard — inventory card for one subagent definition.
 *
 * Shows the agent name, source chip, and the real frontmatter description
 * (agent.description). No AI blurb — descriptions are from AGENT.md
 * frontmatter and are treated as authoritative.
 *
 * @example
 * <AgentCard agent={agent} />
 */
export function AgentCard({ agent, onOpen }: AgentCardProps) {
  return (
    <article
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => onCardKey(e, onOpen)}
      className={`nb-card-sm p-3 flex flex-col gap-2 hover:border-sage/30 transition-colors duration-150 ${onOpen ? cardClickable : ''}`}
    >
      {/* Name + source chip on same row */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-navy leading-snug break-words min-w-0">
          {agent.name}
        </p>
        <SourceChip source={agent.source} />
      </div>

      {/* Real frontmatter description */}
      {agent.description !== null && (
        <p className="text-xs text-navy-light leading-snug">{agent.description}</p>
      )}
    </article>
  );
}
