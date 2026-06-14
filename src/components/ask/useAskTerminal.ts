// useAskTerminal — owns the xterm.js Terminal instance, all PTY refs, and the
// session-spawn / session-switch logic. Extracted from AskTab.tsx for size.

import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { ChatSession } from '../../types';
import { useBoardStore } from '../../store/useBoardStore';

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

const TERM_THEME = {
  background: '#1A1C16',
  foreground: '#F9FAEF',
  cursor: '#CDEDA3',
  cursorAccent: '#1A1C16',
  selectionBackground: '#4C662B66',
};

interface UseAskTerminalOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  setActiveSessionId: (id: string | null) => void;
  setSpawnError: (err: string | null) => void;
  setQuestion: (q: string) => void;
  addChatSession: (s: ChatSession) => void;
  updateChatSessionStatus: (id: string, status: 'ended', code: number | null) => void;
  setPaletteOpen: (open: boolean) => void;
}

export interface UseAskTerminalResult {
  termRef: React.RefObject<Terminal | null>;
  fitRef: React.RefObject<FitAddon | null>;
  displayedIdRef: React.RefObject<string | null>;
  buffersRef: React.RefObject<Map<string, string>>;
  unlistenersRef: React.RefObject<Map<string, UnlistenFn[]>>;
  quickActionTimersRef: React.RefObject<Map<string, ReturnType<typeof setTimeout>[]>>;
  switchToSession: (sessionId: string) => void;
  start: (
    override: { cwd: string; prompt: string } | undefined,
    repoPath: string,
    question: string,
    getRepoName: (p: string) => string,
  ) => Promise<void>;
  handleRunBuild: (
    repoDetection: { repoType: string; label: string },
    repoPath: string,
    getRepoName: (p: string) => string,
  ) => Promise<void>;
  stopSession: (sessionId: string) => void;
  handlePaletteSelect: (command: string) => void;
  handleInsert: (text: string) => void;
}

export function useAskTerminal({
  containerRef,
  setActiveSessionId,
  setSpawnError,
  setQuestion,
  addChatSession,
  updateChatSessionStatus,
  setPaletteOpen,
}: UseAskTerminalOptions): UseAskTerminalResult {
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
  }, [containerRef]);

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
    [ensureTerminal, setActiveSessionId],
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
    async (
      override: { cwd: string; prompt: string } | undefined,
      repoPath: string,
      question: string,
      getRepoName: (p: string) => string,
    ) => {
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
      useBoardStore.getState().logActivity({
        id: crypto.randomUUID(),
        ts: Date.now(),
        kind: 'ask_session_started',
        repoName: rName,
      });
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
        useBoardStore.getState().logActivity({
          id: crypto.randomUUID(),
          ts: Date.now(),
          kind: 'ask_session_ended',
          repoName: rName,
          label: `ended:${String(e.payload.code)}`,
        });
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
    [
      containerRef,
      setSpawnError,
      addChatSession,
      ensureTerminal,
      setActiveSessionId,
      updateChatSessionStatus,
      setQuestion,
    ],
  );

  // Spawns a dev-server / build session using the detected repo type.
  // No caveman injection — this is a build runner, not a claude session.
  const handleRunBuild = useCallback(
    async (
      repoDetection: { repoType: string; label: string },
      repoPath: string,
      getRepoName: (p: string) => string,
    ) => {
      if (repoPath === '' || containerRef.current === null) return;
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
      useBoardStore.getState().logActivity({
        id: crypto.randomUUID(),
        ts: Date.now(),
        kind: 'run_command_fired',
        repoName: rName,
        label: repoDetection.repoType,
      });
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
    },
    [
      containerRef,
      setSpawnError,
      addChatSession,
      ensureTerminal,
      setActiveSessionId,
      updateChatSessionStatus,
      switchToSession,
    ],
  );

  const stopSession = useCallback((sessionId: string) => {
    void invoke('pty_kill', { id: sessionId }).catch(() => undefined);
  }, []);

  // Palette: send the selected invocation string to the active PTY session.
  const handlePaletteSelect = useCallback(
    (command: string) => {
      setPaletteOpen(false);
      const id = displayedIdRef.current;
      if (id !== null) {
        void invoke('pty_write', { id, data: command + '\r' }).catch(() => undefined);
      }
    },
    [setPaletteOpen],
  );

  // Insert text onto the active session's prompt line WITHOUT submitting (no \r),
  // so the user can edit or append args before pressing Enter themselves.
  const handleInsert = useCallback((text: string) => {
    const id = displayedIdRef.current;
    if (id === null) return;
    void invoke('pty_write', { id, data: text }).catch(() => undefined);
    termRef.current?.focus();
  }, []);

  // Cleanup on unmount.
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

  // Resize observer: keep xterm in sync with container size.
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
  }, [containerRef]);

  return {
    termRef,
    fitRef,
    displayedIdRef,
    buffersRef,
    unlistenersRef,
    quickActionTimersRef,
    switchToSession,
    start,
    handleRunBuild,
    stopSession,
    handlePaletteSelect,
    handleInsert,
  };
}
