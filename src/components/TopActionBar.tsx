/**
 * TopActionBar.tsx — global, always-visible action bar for the Ask tab.
 *
 * Collapsed: a quick row of favorites + built-in slash commands, then category
 * pills (Skills / Agents / Commands / MCP / Plugins) with live counts, a search
 * box, and a ⌄ expander.
 *
 * Expanded: a full-width drawer drops down with every Claude capability grouped
 * by type as a grid of buttons. Clicking an item INSERTS its invocation text
 * into the active PTY line (no Enter) so the user can edit/add args before
 * submitting. MCP/agents get a prompt scaffold; skills/commands get the slash.
 *
 * Data comes from the same `useClaudeStore` inventory the Command Palette uses.
 * This bar is the always-visible mouse path; Cmd+K remains the keyboard path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Star, Search } from 'lucide-react';
import { useClaudeStore } from '../store/useClaudeStore';
import { useBoardStore } from '../store/useBoardStore';
import type {
  ClaudeSkill,
  ClaudeAgent,
  ClaudeCommand,
  ClaudeMcpServer,
  ClaudePlugin,
} from '../types';

// ── Invocation builders (text inserted into the prompt, trailing space) ──────

function skillInsert(skill: ClaudeSkill): string {
  const inv = skill.source !== 'local' ? `/${skill.source}:${skill.dirName}` : `/${skill.dirName}`;
  return `${inv} `;
}

function commandInsert(cmd: ClaudeCommand): string {
  return `/${cmd.name} `;
}

// Subagents are not slash-invocable — inject a natural-language scaffold the
// user completes. (`@plugin:agent` does nothing in the Claude REPL.)
function agentInsert(agent: ClaudeAgent): string {
  return `Use the ${agent.name} subagent to `;
}

// MCP servers expose tools implicitly; a mention scaffold nudges Claude to use
// them. Reference-only — no slash form exists.
function mcpInsert(server: ClaudeMcpServer): string {
  return `Use the ${server.name} MCP to `;
}

// Curated built-in slash commands — always present in the quick row.
const BUILTIN_QUICK: { label: string; text: string }[] = [
  { label: '/clear', text: '/clear ' },
  { label: '/compact', text: '/compact ' },
  { label: '/context', text: '/context ' },
  { label: '/model', text: '/model ' },
  { label: '/review', text: '/review ' },
];

// ── Favorites (localStorage-backed pins) ─────────────────────────────────────

const FAV_KEY = 'coruro.topbar.favorites';

interface Favorite {
  label: string;
  text: string;
}

function loadFavorites(): Favorite[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is Favorite =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as Favorite).label === 'string' &&
        typeof (f as Favorite).text === 'string',
    );
  } catch {
    return [];
  }
}

function saveFavorites(favs: Favorite[]): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  } catch {
    /* storage full / unavailable — pins are best-effort */
  }
}

// ── Props ─────────────────────────────────────────────────────────────────

export interface TopActionBarProps {
  /** Insert text into the active PTY line (no Enter). No-op upstream if no session. */
  onInsert(text: string): void;
  /** True when no PTY session is displayed — items disabled with a hint. */
  disabled?: boolean;
  /** Name slug of the currently selected repo, for activity logging. */
  currentRepoName?: string | null;
}

type GroupKey = 'favorites' | 'skills' | 'agents' | 'commands' | 'mcp' | 'plugins';

// ── Component ───────────────────────────────────────────────────────────────

export function TopActionBar({
  onInsert,
  disabled = false,
  currentRepoName = null,
}: TopActionBarProps) {
  const inventory = useClaudeStore((s) => s.inventory);
  const scanClaude = useClaudeStore((s) => s.scanClaude);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState<Favorite[]>(() => loadFavorites());
  const expanderRef = useRef<HTMLButtonElement>(null);

  // Scan once if the inventory hasn't been loaded yet.
  useEffect(() => {
    if (inventory === null) void scanClaude();
  }, [inventory, scanClaude]);

  const skills = inventory?.skills ?? [];
  const agents = inventory?.agents ?? [];
  const commands = inventory?.commands ?? [];
  const mcpServers = inventory?.mcpServers ?? [];
  const plugins = inventory?.plugins ?? [];

  const q = query.trim().toLowerCase();
  const match = (s: string | null | undefined): boolean =>
    q === '' || (s ?? '').toLowerCase().includes(q);

  const fSkills = useMemo(
    () =>
      skills.filter(
        (s) => match(s.name) || match(s.dirName) || match(s.description) || match(s.source),
      ),
    [skills, q],
  );
  const fAgents = useMemo(
    () => agents.filter((a) => match(a.name) || match(a.description) || match(a.source)),
    [agents, q],
  );
  const fCommands = useMemo(
    () => commands.filter((c) => match(c.name) || match(c.description) || match(c.source)),
    [commands, q],
  );
  const fMcp = useMemo(
    () => mcpServers.filter((m) => match(m.name) || match(m.source)),
    [mcpServers, q],
  );
  const fPlugins = useMemo(
    () => plugins.filter((p) => match(p.name) || match(p.description)),
    [plugins, q],
  );

  const isFav = (text: string): boolean => favorites.some((f) => f.text === text);

  const toggleFav = (label: string, text: string): void => {
    setFavorites((prev) => {
      const next = prev.some((f) => f.text === text)
        ? prev.filter((f) => f.text !== text)
        : [...prev, { label, text }];
      saveFavorites(next);
      return next;
    });
  };

  const insert = useCallback(
    (text: string, commandType: string): void => {
      if (disabled) return;
      onInsert(text);
      useBoardStore.getState().logActivity({
        id: crypto.randomUUID(),
        ts: Date.now(),
        kind: 'run_command_fired',
        repoName: currentRepoName ?? null,
        label: commandType,
      });
    },
    [disabled, onInsert, currentRepoName],
  );

  const openTo = (group: GroupKey): void => {
    setOpen(true);
    // Defer to next frame so the drawer exists before we scroll to the group.
    requestAnimationFrame(() => {
      document
        .getElementById(`tab-group-${group}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // ── Render helpers ──────────────────────────────────────────────────────

  const pill = (label: string, count: number, group: GroupKey) => (
    <button
      type="button"
      onClick={() => openTo(group)}
      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-navy-light/70 bg-warm-gray hover:bg-warm-gray/70 hover:text-navy rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
    >
      {label}
      <span className="text-[10px] text-navy-light/40 tabular-nums">{count}</span>
      <ChevronDown size={11} strokeWidth={2} className="text-navy-light/40" />
    </button>
  );

  // One insertable card in the drawer grid.
  const card = (
    key: string,
    name: string,
    sub: string,
    text: string,
    badge?: string,
    commandType = 'command',
  ) => (
    <div
      key={key}
      className="group relative flex items-start gap-1.5 rounded-lg border border-warm-gray/70 bg-cream/40 hover:border-sage hover:bg-sage/5 transition-colors"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => insert(text, commandType)}
        title={disabled ? 'Start a session first' : `Insert: ${text.trim()}`}
        className="flex-1 min-w-0 text-left px-2.5 py-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none"
      >
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px] font-semibold text-navy truncate">{name}</span>
          {badge !== undefined && badge !== '' && (
            <span className="text-[9px] text-sage/80 bg-sage/10 px-1.5 rounded-full shrink-0">
              {badge}
            </span>
          )}
        </div>
        <div className="text-[10px] font-mono text-navy-light/45 truncate">{sub}</div>
      </button>
      <button
        type="button"
        onClick={() => toggleFav(name, text)}
        aria-label={isFav(text) ? `Unpin ${name}` : `Pin ${name}`}
        className="shrink-0 p-1 mt-1 mr-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer focus-visible:outline-none"
      >
        <Star
          size={12}
          strokeWidth={2}
          className={isFav(text) ? 'fill-sage text-sage' : 'text-navy-light/40'}
        />
      </button>
    </div>
  );

  const groupCol = (
    id: GroupKey,
    heading: string,
    count: number,
    children: React.ReactNode,
    twoCol = false,
  ) => (
    <div id={`tab-group-${id}`} className="min-w-0">
      <div className="flex items-center gap-1.5 px-1 pt-3 pb-2.5 mb-1.5 sticky top-0 z-10 bg-cream border-b border-warm-gray/70 shadow-[0_2px_4px_-2px_rgba(0,0,0,0.12)]">
        <span className="text-[10px] font-semibold text-sage uppercase tracking-widest">
          {heading}
        </span>
        <span className="text-[10px] text-navy-light/40 tabular-nums">{count}</span>
      </div>
      <div className={twoCol ? 'grid grid-cols-2 gap-1' : 'flex flex-col gap-1'}>{children}</div>
    </div>
  );

  // ── Collapsed bar ─────────────────────────────────────────────────────────

  return (
    <div className="shrink-0 border-b border-warm-gray bg-cream/60">
      {/* Quick row + pills */}
      <div className="flex items-center gap-2 px-4 py-1.5 flex-wrap">
        {/* Favorites entry point + built-in quick commands */}
        <div className="flex items-center gap-1">
          {pill('Favorites', favorites.length, 'favorites')}
          {BUILTIN_QUICK.map((b) => (
            <button
              key={b.text}
              type="button"
              disabled={disabled}
              onClick={() => insert(b.text, 'builtin')}
              title={`Insert: ${b.text.trim()}`}
              className="px-2 py-1 text-[11px] font-mono text-navy-light/70 bg-warm-gray hover:bg-warm-gray/70 hover:text-navy rounded-full transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
            >
              {b.label}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-warm-gray mx-0.5" />

        {/* Category pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {pill('Plugins', plugins.length, 'plugins')}
          {pill('MCP', mcpServers.length, 'mcp')}
          <span className="w-px h-3.5 bg-warm-gray mx-0.5" />
          {pill('Commands', commands.length, 'commands')}
          {pill('Agents', agents.length, 'agents')}
          {pill('Skills', skills.length, 'skills')}
        </div>

        {/* Search — focusing/typing opens the drawer */}
        <div className="flex items-center gap-1.5 ml-auto">
          <div className="flex items-center gap-1 px-2 py-1 bg-warm-gray rounded-lg">
            <Search size={12} strokeWidth={2} className="text-navy-light/40 shrink-0" />
            <input
              type="text"
              value={query}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value !== '') setOpen(true);
              }}
              placeholder="Search all…"
              className="w-32 bg-transparent text-[11px] text-navy placeholder:text-navy-light/40 focus:outline-none"
            />
          </div>
          <button
            ref={expanderRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse actions' : 'Expand all actions'}
            aria-expanded={open}
            aria-controls="topbar-drawer"
            className="flex items-center gap-0.5 px-2 py-1 text-[11px] text-navy-light/60 hover:text-navy hover:bg-warm-gray/70 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
          >
            <ChevronDown
              size={14}
              strokeWidth={2}
              className={`transition-transform ${open ? 'rotate-180' : ''}`}
            />
            {open ? 'less' : 'more'}
          </button>
        </div>
      </div>

      {/* ── Drawer ─────────────────────────────────────────────────────────── */}
      {open && (
        <div
          id="topbar-drawer"
          role="region"
          aria-label="Claude capabilities"
          className="max-h-[42vh] overflow-y-auto border-t border-warm-gray/60 bg-cream px-4 pb-3 pt-0"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              expanderRef.current?.focus();
            }
          }}
        >
          {disabled && (
            <p className="mb-2 text-[11px] text-terracotta/80 italic">
              Start a session (New) to insert into the prompt.
            </p>
          )}
          {inventory === null ? (
            <p className="text-[12px] text-navy-light/50 italic py-4 text-center">
              Scanning Claude setup…
            </p>
          ) : (
            <div className="flex gap-4 items-start">
              {/* ── FAVORITES zone ──────────────────────────────────────────── */}
              {groupCol(
                'favorites',
                'Favorites',
                favorites.length,
                favorites.length === 0 ? (
                  <p className="text-[11px] text-navy-light/40 italic px-1 py-2">
                    No favorites yet. Tap the star to pin.
                  </p>
                ) : (
                  favorites.map((f) => (
                    <div
                      key={f.text}
                      className="group relative flex items-start gap-1.5 rounded-lg border border-warm-gray/70 bg-cream/40 hover:border-sage hover:bg-sage/5 transition-colors"
                    >
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => insert(f.text, 'favorite')}
                        title={disabled ? 'Start a session first' : `Insert: ${f.text.trim()}`}
                        className="flex-1 min-w-0 text-left px-2.5 py-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none"
                      >
                        <span className="text-[12px] font-semibold text-navy truncate block">
                          {f.label}
                        </span>
                        <div className="text-[10px] font-mono text-navy-light/45 truncate">
                          {f.text.trim()}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleFav(f.label, f.text)}
                        aria-label={`Unpin ${f.label}`}
                        className="shrink-0 p-1 mt-1 mr-0.5 transition-opacity cursor-pointer focus-visible:outline-none"
                      >
                        <Star size={12} strokeWidth={2} className="fill-sage text-sage" />
                      </button>
                    </div>
                  ))
                ),
              )}

              {/* divider */}
              <div className="w-px self-stretch bg-warm-gray shrink-0" />

              {/* ── SOURCES zone (providers — filter / context) ─────────────── */}
              <div className="flex gap-3 shrink-0 w-[300px]">
                {groupCol(
                  'plugins',
                  'Plugins',
                  fPlugins.length,
                  fPlugins.map((p: ClaudePlugin) => {
                    // Plugins aren't directly invocable — clicking filters every
                    // column to that plugin's items by setting the search query.
                    const active = q !== '' && p.name.toLowerCase() === q;
                    return (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => setQuery(active ? '' : p.name)}
                        title={active ? 'Clear filter' : `Filter to ${p.name}`}
                        className={`text-left rounded-lg border px-2.5 py-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage ${
                          active
                            ? 'border-sage bg-sage/10'
                            : 'border-warm-gray/70 bg-cream/40 hover:border-sage hover:bg-sage/5'
                        }`}
                      >
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[12px] font-semibold text-navy truncate">
                            {p.name}
                          </span>
                          {!p.enabled && <span className="text-[9px] text-navy-light/40">off</span>}
                        </div>
                        <div className="text-[10px] text-navy-light/45 truncate">
                          {p.description ?? p.marketplace ?? 'plugin'}
                        </div>
                      </button>
                    );
                  }),
                )}
                {groupCol(
                  'mcp',
                  'MCP',
                  fMcp.length,
                  fMcp.map((m) =>
                    card(
                      `${m.scope}:${m.name}`,
                      m.name,
                      m.transport !== 'unknown' ? m.transport : 'mcp',
                      mcpInsert(m),
                      m.source !== 'user' ? m.source : undefined,
                      'mcp',
                    ),
                  ),
                )}
              </div>

              {/* divider */}
              <div className="w-px self-stretch bg-warm-gray shrink-0" />

              {/* ── INVOCABLES zone (insert into prompt) ────────────────────── */}
              <div className="flex-1 min-w-0 grid grid-cols-[1fr_1.2fr_2.4fr] gap-4 items-start">
                {groupCol(
                  'commands',
                  'Commands',
                  fCommands.length,
                  fCommands.map((c) =>
                    card(
                      c.path,
                      c.name,
                      commandInsert(c).trim(),
                      commandInsert(c),
                      c.source !== 'local' ? c.source : undefined,
                      'command',
                    ),
                  ),
                )}
                {groupCol(
                  'agents',
                  'Agents',
                  fAgents.length,
                  fAgents.map((a) =>
                    card(
                      a.path,
                      a.name,
                      `subagent`,
                      agentInsert(a),
                      a.source !== 'local' ? a.source : undefined,
                      'agent',
                    ),
                  ),
                )}
                {groupCol(
                  'skills',
                  'Skills',
                  fSkills.length,
                  fSkills.map((s) =>
                    card(
                      s.path,
                      s.name,
                      skillInsert(s).trim(),
                      skillInsert(s),
                      s.source !== 'local' ? s.source : undefined,
                      'skill',
                    ),
                  ),
                  true, // 2-column card grid — tames the 221-item list
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
