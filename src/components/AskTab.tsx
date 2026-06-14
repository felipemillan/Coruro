// AskTab — "ask your repos": hosts real interactive Claude Code sessions
// inside the app via a PTY (xterm.js ↔ pty.rs).
//
// A left sidebar lists all sessions grouped by repo. A single Terminal
// instance is reused — switching replays the accumulated output buffer.

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Plus, Square, SquareTerminal, Trash2 } from 'lucide-react';
import { useBoardStore } from '../store/useBoardStore';
import { useViewStore } from '../store/useViewStore';
import { CommandPalette } from './CommandPalette';
import { TopActionBar } from './TopActionBar';
import type { ChatSession } from '../types';

interface PtyOutput {
  id: string;
  data: string;
}

interface PtyExit {
  id: string;
  code: number | null;
}

/** Synthetic scrollback shown when a restored (ended) session is opened — we
 *  persist metadata only, never the real transcript. */
const RESTORED_BANNER = '\r\n\x1b[2m── restored session (ended) ──\x1b[0m\r\n';
/** Undo window (ms) for an inline session delete before teardown is finalized. */
const DELETE_UNDO_MS = 6000;

const TERM_THEME = {
  background: '#1A1C16',
  foreground: '#F9FAEF',
  cursor: '#CDEDA3',
  cursorAccent: '#1A1C16',
  selectionBackground: '#4C662B66',
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function AskTab() {
  const repos = useBoardStore((s) => s.repos);
  const rootDirectory = useBoardStore((s) => s.settings.rootDirectory);
  const sorted = [...repos].sort((a, b) => a.name.localeCompare(b.name));

  const pendingAskPath = useViewStore((s) => s.pendingAskPath);
  const clearPendingAsk = useViewStore((s) => s.clearPendingAsk);
  const pendingAskCommand = useViewStore((s) => s.pendingAskCommand);
  const clearPendingAskCommand = useViewStore((s) => s.clearPendingAskCommand);
  const paletteOpen = useViewStore((s) => s.paletteOpen);
  const setPaletteOpen = useViewStore((s) => s.setPaletteOpen);

  // Sessions are persisted in the board store (metadata only — transcripts are
  // never stored). Render newest-first; the store appends in creation order.
  const storedSessions = useBoardStore((s) => s.chatSessions.sessions);
  const addChatSession = useBoardStore((s) => s.addChatSession);
  const updateChatSessionStatus = useBoardStore((s) => s.updateChatSessionStatus);
  const deleteChatSession = useBoardStore((s) => s.deleteChatSession);
  const sessions = [...storedSessions].sort((a, b) => b.startedAt - a.startedAt);

  const [repoPath, setRepoPath] = useState('');
  const [question, setQuestion] = useState('');
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [repoDetection, setRepoDetection] = useState<{ repoType: string; label: string } | null>(null);
  // Inline-delete undo toast: holds the pending-delete id + label, else null.
  const [deleteToast, setDeleteToast] = useState<{ id: string; label: string } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const newBtnRef = useRef<HTMLButtonElement | null>(null);
  // Which session's output is currently rendered in the terminal.
  const displayedIdRef = useRef<string | null>(null);
  // Accumulated raw output per session (for buffer replay on switch).
  const buffersRef = useRef<Map<string, string>>(new Map());
  // Event unlisten fns keyed by session id.
  const unlistenersRef = useRef<Map<string, UnlistenFn[]>>(new Map());
  // Pending quick-action sequencing timers, keyed by session id, so they can be
  // cancelled if the session ends or the component unmounts before they fire.
  const quickActionTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());
  // Sessions deleted but inside the undo window: stash the full session + its
  // expiry timer so Undo can restore the row (and keep a running PTY alive).
  const pendingDeletesRef = useRef<Map<string, { session: ChatSession; timer: ReturnType<typeof setTimeout> }>>(new Map());

  useEffect(() => {
    if (repoPath === '' && sorted.length > 0) setRepoPath(sorted[0].path);
  }, [repoPath, sorted]);

  // Card "Ask" button pre-selects a repo; clear the signal after consuming it.
  useEffect(() => {
    if (pendingAskPath !== null) {
      setRepoPath(pendingAskPath);
      clearPendingAsk();
    }
  }, [pendingAskPath, clearPendingAsk]);

  // Detect the project type whenever the selected repo changes (for the Run button).
  useEffect(() => {
    if (repoPath === '' || repoPath === rootDirectory) { setRepoDetection(null); return; }
    invoke<{ repoType: string; label: string }>('detect_repo_type', { path: repoPath })
      .then(d => setRepoDetection(d.repoType !== 'Unknown' ? d : null))
      .catch(() => setRepoDetection(null));
  }, [repoPath, rootDirectory]);

  // Cmd+K / Ctrl+K opens the command palette from anywhere in the Ask tab.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setPaletteOpen]);

  const getRepoName = useCallback(
    (path: string) => {
      if (path === rootDirectory) return 'All Repos';
      return sorted.find((r) => r.path === path)?.name ?? path.split('/').pop() ?? path;
    },
    [rootDirectory, sorted],
  );

  // Creates the Terminal once; sets up the single onData handler that routes
  // keyboard input to whichever session is currently displayed.
  const ensureTerminal = useCallback((): Terminal | null => {
    if (termRef.current !== null) return termRef.current;
    if (containerRef.current === null) return null;
    const term = new Terminal({
      fontSize: 12.5,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, 'Courier New', monospace",
      cursorBlink: true,
      theme: TERM_THEME,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    containerRef.current.replaceChildren();
    term.open(containerRef.current);
    fit.fit();
    term.onData((data) => {
      const id = displayedIdRef.current;
      if (id !== null) void invoke('pty_write', { id, data }).catch(() => undefined);
    });
    termRef.current = term;
    fitRef.current = fit;
    return term;
  }, []);

  const switchToSession = useCallback(
    (sessionId: string) => {
      const term = ensureTerminal();
      if (term === null) return;
      displayedIdRef.current = sessionId;
      setActiveSessionId(sessionId);
      // A restored (persisted) session has no live buffer — seed the synthetic
      // "restored" banner once so its terminal isn't blank (transcripts aren't
      // persisted, only metadata).
      let buf = buffersRef.current.get(sessionId);
      if (buf === undefined) {
        buf = RESTORED_BANNER;
        buffersRef.current.set(sessionId, buf);
      }
      term.reset();
      term.write(buf);
      fitRef.current?.fit();
      void invoke('pty_resize', { id: sessionId, cols: term.cols, rows: term.rows }).catch(
        () => undefined,
      );
      term.focus();
    },
    [ensureTerminal],
  );

  // `override` lets callers (e.g. a Command Center quick action) launch a
  // session with an explicit cwd/prompt without waiting for a state commit —
  // this avoids stale-closure races entirely.
  //
  // EVERY session boots at an empty prompt (no `dgc` prompt arg) so we can drive
  // two inputs over the PTY in order — `/caveman:caveman ultra` first (to cut
  // token cost on every session), then the user prompt if one was given. This is
  // the only way to prepend a slash command, since `dgc` takes the prompt as a
  // single positional arg with no room for a command in front.
  const start = useCallback(
    async (override?: { cwd: string; prompt: string }) => {
    const effRepoPath = override?.cwd ?? repoPath;
    const effQuestion = override?.prompt ?? question;
    if (effRepoPath === '' || containerRef.current === null) return;
    setSpawnError(null);

    const id = crypto.randomUUID();
    const title = effQuestion.trim();
    const rName = getRepoName(effRepoPath);

    const session: ChatSession = {
      id,
      repoPath: effRepoPath,
      repoName: rName,
      title,
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
    };

    addChatSession(session);
    buffersRef.current.set(id, '');

    // Point terminal at new session before subscribing so no bytes are missed.
    const term = ensureTerminal()!;
    term.reset();
    displayedIdRef.current = id;
    setActiveSessionId(id);

    // Caveman sequencing: dgc prints SECONDS of scan/boot logs before claude
    // actually starts, so we must NOT fire on first output — that lands the
    // keystrokes in the dgc boot stream and they are lost. Instead gate on
    // claude's own ready marker (its version banner / the `❯` input prompt) in
    // the cumulative session buffer, then send `/caveman:caveman ultra`, then
    // (after the skill has time to activate) the user prompt — if one was given.
    // Timers are tracked so they can be cancelled on exit/unmount.
    let cavemanFired = false;
    const CLAUDE_READY = /Claude Code v|❯/; // banner or the ❯ input caret
    const CAVEMAN_SETTLE_MS = 1200; // after claude is ready, before caveman
    const CAVEMAN_TO_PROMPT_MS = 2800; // let the skill finish loading
    const fireCavemanSequence = () => {
      if (cavemanFired) return;
      cavemanFired = true;
      const timers: ReturnType<typeof setTimeout>[] = [];
      // Settle after claude's input box appears, then send the caveman command
      // (submitted), then the user prompt (submitted) when present.
      timers.push(
        setTimeout(() => {
          void invoke('pty_write', { id, data: '/caveman:caveman ultra\r' }).catch(
            () => undefined,
          );
          if (title !== '') {
            timers.push(
              setTimeout(() => {
                void invoke('pty_write', { id, data: `${title}\r` }).catch(() => undefined);
              }, CAVEMAN_TO_PROMPT_MS),
            );
          }
        }, CAVEMAN_SETTLE_MS),
      );
      quickActionTimersRef.current.set(id, timers);
    };

    const unOut = await listen<PtyOutput>('pty-output', (e) => {
      if (e.payload.id !== id) return;
      const chunk = e.payload.data;
      buffersRef.current.set(id, (buffersRef.current.get(id) ?? '') + chunk);
      if (displayedIdRef.current === id) term.write(chunk);
      // Fire once claude itself is up (banner/❯ in the cumulative buffer),
      // never on dgc's earlier boot logs.
      if (CLAUDE_READY.test(buffersRef.current.get(id) ?? '')) {
        fireCavemanSequence();
      }
    });

    const unExit = await listen<PtyExit>('pty-exit', (e) => {
      if (e.payload.id !== id) return;
      // Session gone — drop any pending quick-action input timers.
      quickActionTimersRef.current.get(id)?.forEach((t) => clearTimeout(t));
      quickActionTimersRef.current.delete(id);
      const msg = `\r\n\x1b[2m── session ended${e.payload.code !== null ? ` (exit ${e.payload.code})` : ''} ──\x1b[0m\r\n`;
      buffersRef.current.set(id, (buffersRef.current.get(id) ?? '') + msg);
      if (displayedIdRef.current === id) term.write(msg);
      updateChatSessionStatus(id, 'ended', e.payload.code);
    });

    unlistenersRef.current.set(id, [unOut, unExit]);

    try {
      // All sessions boot at an empty prompt (no dgc arg) so we can prepend the
      // caveman command over the PTY; the prompt (when present) is then sent via
      // pty_write after the caveman skill activates.
      await invoke('pty_spawn', {
        id,
        cwd: effRepoPath,
        prompt: null,
        cols: term.cols,
        rows: term.rows,
      });
      term.focus();
      setQuestion('');
    } catch (e: unknown) {
      setSpawnError(e instanceof Error ? e.message : String(e));
      updateChatSessionStatus(id, 'ended', -1);
      unlistenersRef.current.get(id)?.forEach((u) => u());
      unlistenersRef.current.delete(id);
    }
  },
  [repoPath, question, getRepoName, ensureTerminal, addChatSession, updateChatSessionStatus],
  );

  // Command Center quick-action: pre-fill cwd + prompt for the UI, then launch
  // immediately via an explicit override so we never depend on a state commit
  // (declared after `start` so the dependency reference is initialized).
  useEffect(() => {
    if (pendingAskCommand !== null) {
      const { cwd, prompt } = pendingAskCommand;
      setRepoPath(cwd);
      setQuestion(prompt);
      clearPendingAskCommand();
      void start({ cwd, prompt });
    }
  }, [pendingAskCommand, clearPendingAskCommand, start]);

  const stopSession = useCallback((sessionId: string) => {
    void invoke('pty_kill', { id: sessionId }).catch(() => undefined);
  }, []);

  // Finalize an inline delete after the undo window lapses: ordered teardown so
  // nothing leaks. Kill is deferred to here (NOT at delete time) so a running
  // PTY survives the undo window and can be restored. A late pty-exit for this
  // id is a harmless no-op (the store entry is already gone, listeners detached).
  const finalizeDelete = useCallback((id: string) => {
    void invoke('pty_kill', { id }).catch(() => undefined); // dead/unknown id no-ops
    quickActionTimersRef.current.get(id)?.forEach((t) => clearTimeout(t));
    quickActionTimersRef.current.delete(id);
    unlistenersRef.current.get(id)?.forEach((u) => u());
    unlistenersRef.current.delete(id);
    buffersRef.current.delete(id);
    pendingDeletesRef.current.delete(id);
    setDeleteToast((t) => (t?.id === id ? null : t));
  }, []);

  // Optimistic inline delete: remove from the store immediately (persists), move
  // selection + focus off the deleted row, and start the undo timer. The PTY is
  // NOT killed yet — that happens in finalizeDelete when the window expires.
  const requestDelete = useCallback(
    (session: ChatSession) => {
      const id = session.id;
      const label = session.title !== '' ? session.title : `${fmtTime(session.startedAt)} session`;

      // If a delete is already pending, finalize it now (one toast at a time).
      const prior = deleteToast;
      if (prior && prior.id !== id) finalizeDelete(prior.id);

      // Move selection off the row before it disappears.
      if (displayedIdRef.current === id) {
        const remaining = sessions.filter((s) => s.id !== id);
        const next = remaining[0];
        if (next) {
          switchToSession(next.id);
        } else {
          displayedIdRef.current = null;
          setActiveSessionId(null);
          termRef.current?.reset();
        }
      }

      deleteChatSession(id); // persisted removal
      const timer = setTimeout(() => finalizeDelete(id), DELETE_UNDO_MS);
      pendingDeletesRef.current.set(id, { session, timer });
      setDeleteToast({ id, label });

      // Deterministic focus return: next remaining row, else the New button.
      requestAnimationFrame(() => {
        const firstRow = document.querySelector<HTMLButtonElement>('[data-session-select]');
        (firstRow ?? newBtnRef.current)?.focus();
      });
    },
    [deleteToast, finalizeDelete, sessions, switchToSession, deleteChatSession],
  );

  const undoDelete = useCallback(() => {
    setDeleteToast((t) => {
      if (t === null) return null;
      const pend = pendingDeletesRef.current.get(t.id);
      if (pend) {
        clearTimeout(pend.timer);
        pendingDeletesRef.current.delete(t.id);
        addChatSession(pend.session); // restore row (display re-sorts by startedAt)
      }
      return null;
    });
  }, [addChatSession]);

  // Spawns a dev-server / build session using the detected repo type.
  // No caveman injection — this is a build runner, not a claude session.
  const handleRunBuild = useCallback(async () => {
    if (repoDetection === null || repoPath === '' || containerRef.current === null) return;
    setSpawnError(null);

    const id = crypto.randomUUID();
    const title = repoDetection.label;
    const rName = getRepoName(repoPath);

    const session: ChatSession = {
      id,
      repoPath,
      repoName: rName,
      title,
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
    };

    addChatSession(session);
    buffersRef.current.set(id, '');

    const term = ensureTerminal()!;
    term.reset();
    displayedIdRef.current = id;
    setActiveSessionId(id);

    const unOut = await listen<PtyOutput>('pty-output', (e) => {
      if (e.payload.id !== id) return;
      const chunk = e.payload.data;
      buffersRef.current.set(id, (buffersRef.current.get(id) ?? '') + chunk);
      if (displayedIdRef.current === id) term.write(chunk);
    });

    const unExit = await listen<PtyExit>('pty-exit', (e) => {
      if (e.payload.id !== id) return;
      const msg = `\r\n\x1b[2m── session ended${e.payload.code !== null ? ` (exit ${e.payload.code})` : ''} ──\x1b[0m\r\n`;
      buffersRef.current.set(id, (buffersRef.current.get(id) ?? '') + msg);
      if (displayedIdRef.current === id) term.write(msg);
      updateChatSessionStatus(id, 'ended', e.payload.code);
    });

    unlistenersRef.current.set(id, [unOut, unExit]);

    try {
      await invoke('pty_spawn_cmd', {
        id,
        cwd: repoPath,
        repoType: repoDetection.repoType,
        cols: term.cols,
        rows: term.rows,
      });
      switchToSession(id);
      term.focus();
    } catch (e: unknown) {
      setSpawnError(e instanceof Error ? e.message : String(e));
      updateChatSessionStatus(id, 'ended', -1);
      unlistenersRef.current.get(id)?.forEach((u) => u());
      unlistenersRef.current.delete(id);
    }
  }, [repoDetection, repoPath, getRepoName, ensureTerminal, switchToSession, addChatSession, updateChatSessionStatus]);

  // Palette: send the selected invocation string to the active PTY session.
  const handlePaletteSelect = useCallback((command: string) => {
    setPaletteOpen(false);
    const id = displayedIdRef.current;
    if (id !== null) {
      void invoke('pty_write', { id, data: command + '\r' }).catch(() => undefined);
    }
  }, [setPaletteOpen]);

  // Insert text onto the active session's prompt line WITHOUT submitting (no \r),
  // so the user can edit or append args before pressing Enter themselves.
  const handleInsert = useCallback((text: string) => {
    const id = displayedIdRef.current;
    if (id === null) return;
    void invoke('pty_write', { id, data: text }).catch(() => undefined);
    termRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      for (const uns of unlistenersRef.current.values()) uns.forEach((u) => u());
      unlistenersRef.current.clear();
      for (const timers of quickActionTimersRef.current.values())
        timers.forEach((t) => clearTimeout(t));
      quickActionTimersRef.current.clear();
      // Pending deletes: clear their undo timers. The store row is already gone;
      // PTYs are intentionally left alive (sessions persist across tab unmounts).
      for (const { timer } of pendingDeletesRef.current.values()) clearTimeout(timer);
      pendingDeletesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => {
      const term = termRef.current;
      const fit = fitRef.current;
      if (term === null || fit === null) return;
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      fit.fit();
      const id = displayedIdRef.current;
      if (id !== null)
        void invoke('pty_resize', { id, cols: term.cols, rows: term.rows }).catch(() => undefined);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Group sessions by repo — Map insertion order = newest repo first (sessions
  // are prepended on start, so first encounter of each repo is most recent).
  const grouped = sessions.reduce<Map<string, { repoName: string; items: ChatSession[] }>>(
    (acc, s) => {
      if (!acc.has(s.repoPath)) acc.set(s.repoPath, { repoName: s.repoName, items: [] });
      acc.get(s.repoPath)!.items.push(s);
      return acc;
    },
    new Map(),
  );

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeRunning = activeSession?.status === 'running';

  return (
    <>
    <CommandPalette
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      repoPath={repoPath}
      onSelect={handlePaletteSelect}
    />
    <div className="flex flex-1 min-h-0">
      {/* ── Sidebar ─────────────────────────────────── */}
      <nav aria-label="Sessions" className="w-52 shrink-0 border-r border-warm-gray flex flex-col bg-cream/30 overflow-y-auto">
        <div className="px-3 py-2.5 border-b border-warm-gray/60">
          <span className="text-[10px] font-semibold text-navy-light/50 uppercase tracking-widest">
            Sessions
          </span>
        </div>
        {sessions.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-navy-light/40 italic leading-relaxed">
            No sessions yet.
            <br />
            Pick a repo and tap New.
          </p>
        ) : (
          <div className="py-1 flex-1">
            {Array.from(grouped.entries()).map(([path, { repoName, items }]) => (
              <div key={path} className="mb-1">
                <div className="px-3 pt-2.5 pb-0.5 text-[10px] font-semibold text-sage uppercase tracking-wide truncate">
                  {repoName}
                </div>
                {items.map((s) => {
                  const label = s.title !== '' ? s.title : `${fmtTime(s.startedAt)} session`;
                  const isActive = activeSessionId === s.id;
                  return (
                    // Row is a container (NOT a button) so the delete button can
                    // be a sibling — no nested interactive elements.
                    <div
                      key={s.id}
                      className={`group flex items-center transition-colors ${
                        isActive ? 'bg-sage/20' : 'hover:bg-warm-gray/70'
                      }`}
                    >
                      <button
                        type="button"
                        data-session-select
                        onClick={() => switchToSession(s.id)}
                        aria-label={`${label} — ${s.status === 'running' ? 'running' : 'ended'}`}
                        className={`flex-1 min-w-0 text-left pl-3 pr-1 py-1.5 flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage ${
                          isActive ? 'text-navy' : 'text-navy-light/60 group-hover:text-navy'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            s.status === 'running'
                              ? 'bg-sage motion-safe:animate-pulse'
                              : 'bg-navy-light/25'
                          }`}
                        />
                        <span className="block flex-1 min-w-0 text-[11px] truncate leading-tight">
                          {label}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDelete(s)}
                        aria-label={`Delete session: ${label}`}
                        className="shrink-0 mr-1 grid place-items-center h-6 w-6 rounded text-terracotta opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-terracotta/15 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta transition-opacity cursor-pointer"
                      >
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {deleteToast !== null && (
          <div
            role="status"
            aria-live="polite"
            className="sticky bottom-0 mx-2 mb-2 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-navy text-cream text-[11px] shadow-lg"
          >
            <span className="truncate">Session deleted</span>
            <button
              type="button"
              onClick={undoDelete}
              className="shrink-0 font-semibold text-sage hover:text-sage/80 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage rounded px-1"
            >
              Undo
            </button>
          </div>
        )}
      </nav>

      {/* ── Right panel ─────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0">
        {/* Controls row */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-warm-gray bg-cream/60">
          <SquareTerminal size={15} strokeWidth={1.75} className="text-sage shrink-0" />
          <select
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            className="px-2 py-1 text-[12px] font-mono bg-warm-gray text-navy rounded-lg cursor-pointer max-w-[180px]"
            aria-label="Repository"
          >
            {rootDirectory !== null && <option value={rootDirectory}>All repos</option>}
            {sorted.map((r) => (
              <option key={r.path} value={r.path}>
                {r.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void start();
            }}
            placeholder={
              repoPath === rootDirectory
                ? 'Ask across all repos… e.g. "which repos use Tailwind v4?"'
                : 'Ask something… (optional — blank opens a plain session)'
            }
            className="flex-1 px-3 py-1.5 text-[12px] bg-warm-gray text-navy rounded-lg placeholder:text-navy-light/40 focus:outline-none focus:ring-1 focus:ring-sage"
          />
          {activeRunning && (
            <button
              type="button"
              onClick={() => activeSession && stopSession(activeSession.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-terracotta bg-terracotta/10 hover:bg-terracotta/20 transition-colors cursor-pointer rounded-full"
            >
              <Square size={12} strokeWidth={2} /> End
            </button>
          )}
          {/* Run/build button — shown only when we know the project type */}
          {repoDetection !== null && (
            <button
              type="button"
              onClick={() => void handleRunBuild()}
              className="flex flex-col items-start px-3 py-1 text-[11px] font-medium text-sage bg-sage/10 hover:bg-sage/20 transition-colors cursor-pointer rounded-full leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
            >
              <span>Run</span>
              <span className="text-[9px] font-mono text-sage/70">{repoDetection.label}</span>
            </button>
          )}

          {/* Cmd+K palette hint badge */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette (⌘K)"
            className="px-2 py-1 text-[10px] font-mono text-navy-light/50 bg-warm-gray hover:bg-warm-gray/80 rounded-lg cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
          >
            ⌘K
          </button>

          <button
            type="button"
            onClick={() => void start()}
            disabled={repoPath === ''}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-cream bg-navy hover:bg-navy-light transition-colors cursor-pointer rounded-full disabled:opacity-40"
          >
            <Plus size={12} strokeWidth={2.5} /> New
          </button>
        </div>

        {/* Global action bar — insert skills/agents/commands/MCP into the prompt */}
        <TopActionBar onInsert={handleInsert} disabled={activeSessionId === null} />

        {spawnError !== null && (
          <div className="shrink-0 px-4 py-1.5 text-[11px] font-mono bg-terracotta/15 text-terracotta border-b border-terracotta/40">
            Failed to start: {spawnError} — is Claude Code installed? (`npm i -g
            @anthropic-ai/claude-code`)
          </div>
        )}

        {/* Terminal area */}
        <div className="relative flex-1 min-h-0 bg-[#1A1C16]">
          {activeSessionId === null && (
            <div className="absolute inset-x-0 mt-24 flex flex-col items-center gap-2 pointer-events-none">
              <SquareTerminal size={28} strokeWidth={1.25} className="text-cream/20" />
              <p className="text-[13px] text-cream/30">
                {repoPath !== ''
                  ? `Ask Claude Code about ${getRepoName(repoPath)}`
                  : 'Pick a repo to start'}
              </p>
              <p className="text-[11px] text-cream/20">
                Runs your local Claude Code on your existing plan — no API key.
              </p>
            </div>
          )}
          <div ref={containerRef} className="h-full w-full px-2 py-1" />
        </div>
      </div>
    </div>
    </>
  );
}
