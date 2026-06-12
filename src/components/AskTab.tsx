// AskTab — "ask your repos": hosts a real interactive Claude Code session
// inside the app via a PTY (xterm.js frontend ↔ pty.rs backend).
//
// Flow: pick a repo, optionally type a starting question, Start. The backend
// spawns `claude "<question>"` through a login shell in the repo directory —
// an interactive terminal session, billed against the user's existing Claude
// subscription exactly like running it in Terminal.app. We host the TUI; we
// never parse it.
//
// The component is kept mounted across tab switches (see App.tsx) so the
// session survives navigating to Notes/Board and back.

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Play, Square, SquareTerminal } from 'lucide-react';
import { useBoardStore } from '../store/useBoardStore';

interface PtyOutput {
  id: string;
  data: string;
}

interface PtyExit {
  id: string;
  code: number | null;
}

const TERM_THEME = {
  background: '#1A1C16', // navy — dark panel against the cream app
  foreground: '#F9FAEF', // cream
  cursor: '#CDEDA3', // sage-light
  cursorAccent: '#1A1C16',
  selectionBackground: '#4C662B66', // sage @ 40%
};

export function AskTab() {
  const repos = useBoardStore((s) => s.repos);
  const rootDirectory = useBoardStore((s) => s.settings.rootDirectory);
  const sorted = [...repos].sort((a, b) => a.name.localeCompare(b.name));

  const [repoPath, setRepoPath] = useState<string>('');
  const [question, setQuestion] = useState('');
  const [running, setRunning] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<string | null>(null);
  const unlistenersRef = useRef<UnlistenFn[]>([]);

  // Default the repo picker to the first repo once the scan lands.
  useEffect(() => {
    if (repoPath === '' && sorted.length > 0) setRepoPath(sorted[0].path);
  }, [repoPath, sorted]);

  const teardown = useCallback((opts?: { keepTerminal?: boolean }) => {
    const id = idRef.current;
    idRef.current = null;
    if (id !== null) void invoke('pty_kill', { id }).catch(() => undefined);
    for (const un of unlistenersRef.current) un();
    unlistenersRef.current = [];
    if (!opts?.keepTerminal) {
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    }
    setRunning(false);
  }, []);

  // Kill the session + listeners when the component truly unmounts.
  useEffect(() => () => teardown(), [teardown]);

  const start = useCallback(async () => {
    if (repoPath === '' || containerRef.current === null) return;
    setSpawnError(null);
    teardown(); // one session at a time; disposes any previous terminal

    const term = new Terminal({
      fontSize: 12.5,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, 'Courier New', monospace",
      cursorBlink: true,
      theme: TERM_THEME,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    containerRef.current.replaceChildren(); // drop any disposed terminal DOM
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const id = crypto.randomUUID();
    idRef.current = id;

    term.onData((data) => {
      if (idRef.current === id) void invoke('pty_write', { id, data }).catch(() => undefined);
    });

    // Subscribe before spawning so the first bytes are never missed.
    const unOut = await listen<PtyOutput>('pty-output', (e) => {
      if (e.payload.id === id) term.write(e.payload.data);
    });
    const unExit = await listen<PtyExit>('pty-exit', (e) => {
      if (e.payload.id !== id) return;
      if (idRef.current === id) idRef.current = null;
      setRunning(false);
      term.write(
        `\r\n\x1b[2m── session ended${e.payload.code !== null ? ` (exit ${e.payload.code})` : ''} ──\x1b[0m\r\n`,
      );
    });
    unlistenersRef.current = [unOut, unExit];

    try {
      await invoke('pty_spawn', {
        id,
        cwd: repoPath,
        prompt: question.trim() === '' ? null : question.trim(),
        cols: term.cols,
        rows: term.rows,
      });
      setRunning(true);
      term.focus();
    } catch (e: unknown) {
      setSpawnError(e instanceof Error ? e.message : String(e));
      teardown({ keepTerminal: true });
    }
  }, [repoPath, question, teardown]);

  const stop = useCallback(() => {
    const id = idRef.current;
    if (id !== null) void invoke('pty_kill', { id }).catch(() => undefined);
  }, []);

  // Keep the PTY size in sync with the rendered terminal. Fires when the tab
  // becomes visible again (hidden → display:flex) and on window resizes.
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => {
      const term = termRef.current;
      const fit = fitRef.current;
      const id = idRef.current;
      if (term === null || fit === null) return;
      if (el.clientWidth === 0 || el.clientHeight === 0) return; // hidden tab
      fit.fit();
      if (id !== null) {
        void invoke('pty_resize', { id, cols: term.cols, rows: term.rows }).catch(
          () => undefined,
        );
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const repoName =
    repoPath !== '' && repoPath === rootDirectory
      ? 'all your repos'
      : (sorted.find((r) => r.path === repoPath)?.name ?? '');

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ── Controls row ─────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-warm-gray bg-cream/60">
        <SquareTerminal size={15} strokeWidth={1.75} className="text-sage shrink-0" />
        <select
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          disabled={running}
          className="px-2 py-1 text-[12px] font-mono bg-warm-gray text-navy rounded-lg cursor-pointer disabled:opacity-50 max-w-[220px]"
          aria-label="Repository"
        >
          {rootDirectory !== null && (
            <option value={rootDirectory}>All repos — search across everything</option>
          )}
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
            if (e.key === 'Enter' && !running) void start();
          }}
          disabled={running}
          placeholder={
            repoPath !== '' && repoPath === rootDirectory
              ? 'Find something across all repos… e.g. "which repos use Tailwind v4?"'
              : 'Ask something about this repo… (optional — blank opens a plain session)'
          }
          className="flex-1 px-3 py-1.5 text-[12px] bg-warm-gray text-navy rounded-lg placeholder:text-navy-light/40 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-sage"
        />
        {running ? (
          <button
            type="button"
            onClick={stop}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-terracotta bg-terracotta/10 hover:bg-terracotta/20 transition-colors cursor-pointer rounded-full"
          >
            <Square size={12} strokeWidth={2} /> End session
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={repoPath === ''}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-cream bg-navy hover:bg-navy-light transition-colors cursor-pointer rounded-full disabled:opacity-40"
          >
            <Play size={12} strokeWidth={2} /> Start
          </button>
        )}
      </div>

      {spawnError !== null && (
        <div className="shrink-0 px-4 py-1.5 text-[11px] font-mono bg-terracotta/15 text-terracotta border-b border-terracotta/40">
          Failed to start session: {spawnError} — is Claude Code installed? (`npm i -g
          @anthropic-ai/claude-code`)
        </div>
      )}

      {/* ── Terminal ─────────────────────────────────────────── */}
      <div className="relative flex-1 min-h-0 bg-[#1A1C16]">
        {termRef.current === null && (
          <div className="absolute inset-x-0 mt-24 flex flex-col items-center gap-2 pointer-events-none">
            <SquareTerminal size={28} strokeWidth={1.25} className="text-cream/20" />
            <p className="text-[13px] text-cream/30">
              {repoName !== '' ? `Ask Claude Code about ${repoName}` : 'Pick a repo to start'}
            </p>
            <p className="text-[11px] text-cream/20">
              Runs your local Claude Code on your existing plan — no API key.
            </p>
          </div>
        )}
        <div ref={containerRef} className="h-full w-full px-2 py-1" />
      </div>
    </div>
  );
}
