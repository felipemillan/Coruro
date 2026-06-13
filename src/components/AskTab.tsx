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
import { Plus, Square, SquareTerminal } from 'lucide-react';
import { useBoardStore } from '../store/useBoardStore';
import { useViewStore } from '../store/useViewStore';

interface PtyOutput {
  id: string;
  data: string;
}

interface PtyExit {
  id: string;
  code: number | null;
}

interface ChatSession {
  id: string;
  repoPath: string;
  repoName: string;
  title: string;
  startedAt: number;
  status: 'running' | 'ended';
  exitCode: number | null;
}

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

  const [repoPath, setRepoPath] = useState('');
  const [question, setQuestion] = useState('');
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Which session's output is currently rendered in the terminal.
  const displayedIdRef = useRef<string | null>(null);
  // Accumulated raw output per session (for buffer replay on switch).
  const buffersRef = useRef<Map<string, string>>(new Map());
  // Event unlisten fns keyed by session id.
  const unlistenersRef = useRef<Map<string, UnlistenFn[]>>(new Map());
  // Pending quick-action sequencing timers, keyed by session id, so they can be
  // cancelled if the session ends or the component unmounts before they fire.
  const quickActionTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());

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
      const buf = buffersRef.current.get(sessionId) ?? '';
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

    setSessions((prev) => [session, ...prev]);
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
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: 'ended', exitCode: e.payload.code } : s)),
      );
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
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: 'ended', exitCode: -1 } : s)),
      );
      unlistenersRef.current.get(id)?.forEach((u) => u());
      unlistenersRef.current.delete(id);
    }
  },
  [repoPath, question, getRepoName, ensureTerminal],
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
    <div className="flex flex-1 min-h-0">
      {/* ── Sidebar ─────────────────────────────────── */}
      <div className="w-52 shrink-0 border-r border-warm-gray flex flex-col bg-cream/30 overflow-y-auto">
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
          <div className="py-1">
            {Array.from(grouped.entries()).map(([path, { repoName, items }]) => (
              <div key={path} className="mb-1">
                <div className="px-3 pt-2.5 pb-0.5 text-[10px] font-semibold text-sage uppercase tracking-wide truncate">
                  {repoName}
                </div>
                {items.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => switchToSession(s.id)}
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors cursor-pointer ${
                      activeSessionId === s.id
                        ? 'bg-sage/20 text-navy'
                        : 'text-navy-light/60 hover:bg-warm-gray/70 hover:text-navy'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        s.status === 'running' ? 'bg-sage animate-pulse' : 'bg-navy-light/25'
                      }`}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[11px] truncate leading-tight">
                        {s.title !== '' ? s.title : `${fmtTime(s.startedAt)} session`}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

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
          <button
            type="button"
            onClick={() => void start()}
            disabled={repoPath === ''}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-cream bg-navy hover:bg-navy-light transition-colors cursor-pointer rounded-full disabled:opacity-40"
          >
            <Plus size={12} strokeWidth={2.5} /> New
          </button>
        </div>

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
  );
}
