// SubTabNav.tsx — Segmented horizontal navigation for the Claude Command Center tab.
// Renders five sub-tabs (Overview / MCP / Skills / Agents / Sessions) with icon,
// label, and an optional count badge. Controlled component; callers own the state.

import {
  LayoutDashboard,
  Server,
  Wrench,
  BrainCircuit,
  FolderGit2,
  ListChecks,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The five sub-sections of the Claude Command Center. */
export type ClaudeSubTab =
  | 'overview'
  | 'mcp'
  | 'skills'
  | 'agents'
  | 'sessions'
  | 'recommendations';

export interface SubTabNavProps {
  /** Currently active sub-tab. */
  active: ClaudeSubTab;
  /** Called when the user selects a different tab. */
  onChange: (t: ClaudeSubTab) => void;
  /** Optional count badge displayed in parentheses next to the label. */
  counts?: Partial<Record<ClaudeSubTab, number>>;
}

// ---------------------------------------------------------------------------
// Tab descriptor table
// ---------------------------------------------------------------------------

interface TabDescriptor {
  id: ClaudeSubTab;
  label: string;
  Icon: LucideIcon;
}

const TABS: TabDescriptor[] = [
  { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { id: 'mcp', label: 'MCP', Icon: Server },
  { id: 'skills', label: 'Skills', Icon: Wrench },
  { id: 'agents', label: 'Agents', Icon: BrainCircuit },
  { id: 'sessions', label: 'Sessions', Icon: FolderGit2 },
  { id: 'recommendations', label: 'Curate', Icon: ListChecks },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Horizontal sub-tab navigation bar for the Claude Command Center.
 *
 * @example
 * <SubTabNav active={subTab} onChange={setSubTab} counts={{ mcp: 12, skills: 4 }} />
 */
export function SubTabNav({ active, onChange, counts = {} }: SubTabNavProps) {
  return (
    <nav
      role="tablist"
      aria-label="Command Center sections"
      className="flex items-end gap-0 border-b border-warm-gray bg-cream/60 shrink-0 px-3"
    >
      {TABS.map(({ id, label, Icon }) => {
        const isActive = id === active;
        const count = counts[id];

        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`subtab-panel-${id}`}
            onClick={() => onChange(id)}
            className={[
              // Base layout
              'relative flex items-center gap-1.5 px-3 py-2.5 cursor-pointer',
              'text-[10px] font-semibold uppercase tracking-widest',
              'transition-colors select-none whitespace-nowrap',
              // Bottom border indicator (active)
              'border-b-2',
              // Focus ring — keyboard accessible
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/50 focus-visible:ring-offset-1 rounded-t-sm',
              // Active vs inactive
              isActive
                ? 'border-sage text-navy bg-cream'
                : 'border-transparent text-navy-light/60 hover:text-navy hover:border-warm-gray',
            ].join(' ')}
          >
            <Icon size={12} strokeWidth={isActive ? 2 : 1.75} aria-hidden="true" />
            <span>{label}</span>
            {count !== undefined && (
              <span
                className={['tabular-nums', isActive ? 'text-navy/60' : 'text-navy-light/40'].join(
                  ' ',
                )}
              >
                ({count})
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
