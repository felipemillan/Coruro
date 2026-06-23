/**
 * TopActionBar.tsx — global, always-visible action bar for the Code (Ask) tab.
 *
 * Collapsed: a quick row of Favorites + built-in slash commands + user quick
 * commands, then a single "Insert" trigger, a search box, and a ⌄ expander.
 *
 * TWO drawers share one full-width region below the bar (`openMenu`):
 *
 *   openMenu === 'favorites'
 *     A column megamenu of pinned favorites, bucketed by inferred category
 *     (Skills / Agents / Commands / MCP). Escape closes and returns focus to
 *     `favTriggerRef`.
 *
 *   openMenu === 'inventory'
 *     A five-column megamenu: Plugins | MCP | Commands | Agents | Skills.
 *     Clicking a PLUGIN pivots — the other four columns filter to items whose
 *     `source` matches that plugin name (click again / ✕ to clear). Clicking a
 *     leaf (MCP / Command / Agent / Skill) inserts its invocation. Escape
 *     closes and returns focus to `expanderRef`.
 *
 * ## closeAll contract
 *
 *   Pass a `closeAllRef` prop of type `React.MutableRefObject<(() => void) | null>`.
 *   This component writes its `closeAll` function into that ref on every render,
 *   so the parent can call `closeAllRef.current?.()` to close whichever menu is
 *   open — e.g. when the PTY terminal gains focus.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Star, Search, Pencil, X } from 'lucide-react';
import { QuickCmdsDialog, loadUserCmds, type UserCmd } from './ask/QuickCmdsDialog';
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
  { label: '/caveman ultra', text: '/caveman:caveman ultra ' },
];

// ── Favorites (localStorage-backed pins) ─────────────────────────────────────

const FAV_KEY = 'coruro.topbar.favorites';

interface Favorite {
  label: string;
  text: string;
}

/** Favorite buckets, mirroring the four insertable leaf categories. */
type FavCategory = 'skills' | 'agents' | 'commands' | 'mcp';

const FAV_COLS: { key: FavCategory; label: string }[] = [
  { key: 'skills', label: 'Skills' },
  { key: 'agents', label: 'Agents' },
  { key: 'commands', label: 'Commands' },
  { key: 'mcp', label: 'MCP' },
];

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
  /**
   * closeAll contract — if provided, this component writes its `closeAll`
   * function into the ref on every render so the parent can close whichever
   * menu is open (e.g. on terminal focus).
   */
  closeAllRef?: React.MutableRefObject<(() => void) | null>;
}

/** Which drawer (if any) is open below the bar. */
type OpenMenu = 'favorites' | 'inventory' | null;

// ── Component ───────────────────────────────────────────────────────────────

export function TopActionBar({
  onInsert,
  disabled = false,
  currentRepoName = null,
  closeAllRef,
}: TopActionBarProps) {
  const inventory = useClaudeStore((s) => s.inventory);
  const scanClaude = useClaudeStore((s) => s.scanClaude);

  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  // Plugin pivot: when set, the MCP/Commands/Agents/Skills columns filter to
  // items whose `source` matches this plugin name. null = no plugin filter.
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState<Favorite[]>(() => loadFavorites());
  const [userCmds, setUserCmds] = useState<UserCmd[]>(() => loadUserCmds());
  const [editCmdsOpen, setEditCmdsOpen] = useState(false);

  // Focus-return refs — one per trigger.
  const favTriggerRef = useRef<HTMLButtonElement>(null); // Favorites pill
  const expanderRef = useRef<HTMLButtonElement>(null); // ⌄ expander / Insert

  // Ref for the pencil (edit quick commands) button — focus-return for QuickCmdsDialog.
  const pencilRef = useRef<HTMLButtonElement>(null);

  // Scan once if the inventory hasn't been loaded yet.
  useEffect(() => {
    if (inventory === null) void scanClaude();
  }, [inventory, scanClaude]);

  // ── closeAll — exposed to parent via closeAllRef prop ──────────────────
  const closeAll = useCallback((): void => {
    setOpenMenu(null);
  }, []);

  useEffect(() => {
    if (closeAllRef) closeAllRef.current = closeAll;
  });

  const skills = inventory?.skills ?? [];
  const agents = inventory?.agents ?? [];
  const commands = inventory?.commands ?? [];
  const mcpServers = inventory?.mcpServers ?? [];
  const plugins = inventory?.plugins ?? [];

  const q = query.trim().toLowerCase();
  const match = (s: string | null | undefined): boolean =>
    q === '' || (s ?? '').toLowerCase().includes(q);

  // Text-search filters (applied to every column).
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

  // Plugin-pivot filter — applied to leaf columns on top of the text search.
  const bySource = <T extends { source: string }>(arr: T[]): T[] =>
    selectedSource === null ? arr : arr.filter((i) => i.source === selectedSource);

  const colMcp = bySource(fMcp);
  const colCommands = bySource(fCommands);
  const colAgents = bySource(fAgents);
  const colSkills = bySource(fSkills);

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

  /** Toggle the inventory megamenu. */
  const openInventory = (): void => {
    setOpenMenu((prev) => (prev === 'inventory' ? null : 'inventory'));
  };

  /** Toggle the favorites megamenu. */
  const openFavoritesMenu = (): void => {
    setOpenMenu((prev) => (prev === 'favorites' ? null : 'favorites'));
  };

  // ── Favorite category inference (no schema change — computed at render) ────
  // Pins store only {label, text}; we bucket them by parsing the invocation:
  //   "Use the X subagent to" → agents · "Use the X MCP to" → mcp
  //   "/foo" that exactly matches a known skill insert → skills · else commands
  const favCategory = useCallback(
    (text: string): FavCategory => {
      const t = text.trim();
      if (t.startsWith('Use the ') && t.includes('subagent')) return 'agents';
      if (t.startsWith('Use the ') && / MCP\b/.test(t)) return 'mcp';
      if (t.startsWith('/')) {
        if (skills.some((s) => skillInsert(s).trim() === t)) return 'skills';
        return 'commands';
      }
      return 'commands';
    },
    [skills],
  );

  const favBuckets = useMemo(() => {
    const b: Record<FavCategory, Favorite[]> = { skills: [], agents: [], commands: [], mcp: [] };
    for (const f of favorites) b[favCategory(f.text)].push(f);
    return b;
  }, [favorites, favCategory]);

  const totalInventory =
    plugins.length + mcpServers.length + commands.length + agents.length + skills.length;

  // ── Render helpers ──────────────────────────────────────────────────────

  /** One megamenu column: heading + count + independently-scrolling body. */
  const megaCol = (id: string, heading: string, count: number, children: React.ReactNode) => (
    <div key={id} className="min-w-0 flex flex-col">
      <div className="flex items-center justify-between gap-1.5 px-1 pb-2 mb-2 border-b-2 border-navy/15">
        <span className="text-[10px] font-bold text-sage uppercase tracking-widest">{heading}</span>
        <span className="text-[10px] text-navy-light/40 tabular-nums">{count}</span>
      </div>
      <div className="flex flex-col gap-1.5 overflow-y-auto pr-1 max-h-[38vh] min-h-0">
        {count === 0 ? (
          <p className="text-[10px] text-navy-light/35 italic px-1 py-2">none</p>
        ) : (
          children
        )}
      </div>
    </div>
  );

  // One insertable leaf card (MCP / Command / Agent / Skill).
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
      className="nb-card-sm group relative flex items-start gap-1.5 hover:border-sage hover:bg-sage/5 transition-colors"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => insert(text, commandType)}
        title={disabled ? 'Start a session first' : `Insert: ${text.trim()}`}
        className="flex-1 min-w-0 text-left px-2.5 py-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none"
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

  // Plugin pivot card — clicking filters the other columns by `source`.
  const pluginCard = (p: ClaudePlugin) => {
    const active = selectedSource === p.name;
    return (
      <button
        key={p.name}
        type="button"
        onClick={() => setSelectedSource(active ? null : p.name)}
        title={active ? 'Clear filter' : `Show ${p.name}'s items`}
        className={`nb-card-sm text-left px-2.5 py-2 transition-colors cursor-pointer ${
          active ? 'border-sage bg-sage/15 ring-1 ring-sage' : 'hover:border-sage hover:bg-sage/5'
        }`}
      >
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px] font-semibold text-navy truncate">{p.name}</span>
          {!p.enabled && <span className="text-[9px] text-navy-light/40">off</span>}
        </div>
        <div className="text-[10px] text-navy-light/45 truncate">
          {p.description ?? p.marketplace ?? 'plugin'}
        </div>
      </button>
    );
  };

  // One favorite card (used in the favorites megamenu columns).
  const favCard = (f: Favorite) => (
    <div
      key={f.text}
      className="nb-card-sm group relative flex items-start gap-1.5 hover:border-sage hover:bg-sage/5 transition-colors"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          insert(f.text, 'favorite');
          setOpenMenu(null);
        }}
        title={disabled ? 'Start a session first' : `Insert: ${f.text.trim()}`}
        className="flex-1 min-w-0 text-left px-2.5 py-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none"
      >
        <span className="text-[12px] font-semibold text-navy truncate block">{f.label}</span>
        <div className="text-[10px] font-mono text-navy-light/45 truncate">{f.text.trim()}</div>
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
  );

  const favOpen = openMenu === 'favorites';
  const inventoryOpen = openMenu === 'inventory';
  const drawerOpen = openMenu !== null;

  // ── Collapsed bar ─────────────────────────────────────────────────────────

  return (
    <div className="shrink-0 border-b border-warm-gray bg-cream/60">
      {/* Quick row */}
      <div className="flex items-center gap-2 px-4 py-1.5 flex-wrap">
        {/* Favorites pill + built-in quick commands + user quick commands */}
        <div className="flex items-center gap-1">
          {/* ── Favorites pill — opens the favorites megamenu ── */}
          <button
            ref={favTriggerRef}
            type="button"
            onClick={openFavoritesMenu}
            aria-haspopup="dialog"
            aria-expanded={favOpen}
            aria-controls="topbar-drawer"
            className={`nb-chip flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
              favOpen
                ? 'bg-sage/15 border-sage text-navy'
                : 'bg-warm-gray text-navy-light/70 hover:bg-warm-gray/70 hover:text-navy'
            }`}
          >
            <Star
              size={11}
              strokeWidth={2}
              className={favorites.length > 0 ? 'text-sage' : 'text-navy-light/40'}
            />
            Favorites
            <span className="text-[10px] text-navy-light/40 tabular-nums">{favorites.length}</span>
            <ChevronDown
              size={11}
              strokeWidth={2}
              className={`text-navy-light/40 transition-transform ${favOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {BUILTIN_QUICK.map((b) => (
            <button
              key={b.text}
              type="button"
              disabled={disabled}
              onClick={() => insert(b.text, 'builtin')}
              title={`Insert: ${b.text.trim()}`}
              className="nb-chip px-2 py-1 text-[11px] font-mono text-navy-light/70 bg-warm-gray hover:bg-warm-gray/70 hover:text-navy transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {b.label}
            </button>
          ))}
          {userCmds.map((c) => (
            <button
              key={c.text}
              type="button"
              disabled={disabled}
              onClick={() => insert(c.text, 'user-quick')}
              title={`Insert: ${c.text.trim()}`}
              className="nb-chip px-2 py-1 text-[11px] font-mono text-navy-light/70 border-dashed border-navy-light/30 hover:border-sage hover:text-navy transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {c.label}
            </button>
          ))}
          {/* Edit user quick commands */}
          <button
            ref={pencilRef}
            type="button"
            onClick={() => setEditCmdsOpen(true)}
            aria-label="Edit quick commands"
            title="Edit quick commands"
            className="nb-btn flex items-center justify-center w-7 h-7 text-navy-light/40 hover:text-navy hover:bg-warm-gray/70 transition-colors cursor-pointer"
          >
            <Pencil size={11} strokeWidth={2} />
          </button>
        </div>
        {editCmdsOpen && (
          <QuickCmdsDialog
            triggerRef={pencilRef}
            onClose={() => setEditCmdsOpen(false)}
            cmds={userCmds}
            onChange={setUserCmds}
          />
        )}

        <div className="w-px h-4 bg-warm-gray mx-0.5" />

        {/* Single "Insert ▾" button — opens the five-column inventory megamenu. */}
        <button
          type="button"
          onClick={openInventory}
          aria-haspopup="dialog"
          aria-expanded={inventoryOpen}
          aria-controls="topbar-drawer"
          className={`nb-chip flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
            inventoryOpen
              ? 'bg-sage/15 border-sage text-navy'
              : 'bg-warm-gray text-navy-light/70 hover:bg-warm-gray/70 hover:text-navy'
          }`}
        >
          Insert
          <span className="text-[10px] text-navy-light/40 tabular-nums">{totalInventory}</span>
          <ChevronDown
            size={11}
            strokeWidth={2}
            className={`text-navy-light/40 transition-transform ${inventoryOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Search — focusing/typing opens the inventory megamenu */}
        <div className="flex items-center gap-1.5 ml-auto">
          <div className="nb-input flex items-center gap-1 px-2 py-1">
            <Search size={12} strokeWidth={2} className="text-navy-light/40 shrink-0" />
            <input
              type="text"
              value={query}
              onFocus={() => setOpenMenu('inventory')}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value !== '') setOpenMenu('inventory');
              }}
              placeholder="Search all…"
              className="w-[clamp(80px,10vw,160px)] bg-transparent text-[11px] text-navy placeholder:text-navy-light/40 focus:outline-none"
            />
          </div>
          {/* ⌄ expander — opens INVENTORY megamenu */}
          <button
            ref={expanderRef}
            type="button"
            onClick={openInventory}
            aria-label={inventoryOpen ? 'Collapse actions' : 'Expand all actions'}
            aria-expanded={inventoryOpen}
            aria-controls="topbar-drawer"
            className="nb-btn flex items-center gap-0.5 px-2 py-1 text-[11px] text-navy-light/60 hover:text-navy hover:bg-warm-gray/70 transition-colors cursor-pointer"
          >
            <ChevronDown
              size={14}
              strokeWidth={2}
              className={`transition-transform ${inventoryOpen ? 'rotate-180' : ''}`}
            />
            {inventoryOpen ? 'less' : 'more'}
          </button>
        </div>
      </div>

      {/* ── Megamenu drawer (favorites OR inventory) ───────────────────────── */}
      {drawerOpen && (
        <div
          id="topbar-drawer"
          role="region"
          aria-label={favOpen ? 'Pinned favorites' : 'Claude capabilities'}
          className="nb-flat max-h-[48vh] overflow-y-auto border-t px-5 pb-5 pt-3"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              const trigger = favOpen ? favTriggerRef : expanderRef;
              setOpenMenu(null);
              trigger.current?.focus();
            }
          }}
        >
          {disabled && (
            <p className="mb-3 text-[11px] text-terracotta/80 italic">
              Start a session (New) to insert into the prompt.
            </p>
          )}

          {inventory === null ? (
            <p className="text-[12px] text-navy-light/50 italic py-4 text-center">
              Scanning Claude setup…
            </p>
          ) : favOpen ? (
            // ── Favorites megamenu — columns by inferred category ──────────
            favorites.length === 0 ? (
              <p className="text-[11px] text-navy-light/40 italic px-1 py-6 text-center">
                No favorites yet. Tap ★ on any item in Insert to pin it.
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-4">
                {FAV_COLS.map((col) =>
                  megaCol(
                    `fav-${col.key}`,
                    col.label,
                    favBuckets[col.key].length,
                    favBuckets[col.key].map((f) => favCard(f)),
                  ),
                )}
              </div>
            )
          ) : (
            // ── Inventory megamenu — five live columns + plugin pivot ──────
            <>
              {selectedSource !== null && (
                <div className="flex items-center gap-2 pb-3">
                  <span className="text-[10px] text-navy-light/50 uppercase tracking-widest">
                    Filtered to
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedSource(null)}
                    className="nb-chip flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-sage/15 border-sage text-navy cursor-pointer"
                  >
                    {selectedSource}
                    <X size={11} strokeWidth={2.5} />
                  </button>
                </div>
              )}
              <div className="grid grid-cols-5 gap-4">
                {megaCol(
                  'plugins',
                  'Plugins',
                  fPlugins.length,
                  fPlugins.map((p) => pluginCard(p)),
                )}
                {megaCol(
                  'mcp',
                  'MCP',
                  colMcp.length,
                  colMcp.map((m) =>
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
                {megaCol(
                  'commands',
                  'Commands',
                  colCommands.length,
                  colCommands.map((c) =>
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
                {megaCol(
                  'agents',
                  'Agents',
                  colAgents.length,
                  colAgents.map((a) =>
                    card(
                      a.path,
                      a.name,
                      'subagent',
                      agentInsert(a),
                      a.source !== 'local' ? a.source : undefined,
                      'agent',
                    ),
                  ),
                )}
                {megaCol(
                  'skills',
                  'Skills',
                  colSkills.length,
                  colSkills.map((s) =>
                    card(
                      s.path,
                      s.name,
                      skillInsert(s).trim(),
                      skillInsert(s),
                      s.source !== 'local' ? s.source : undefined,
                      'skill',
                    ),
                  ),
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
