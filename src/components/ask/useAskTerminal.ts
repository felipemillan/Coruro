// useAskTerminal — owns the xterm.js Terminal instance, all PTY refs, and the
// session-spawn / session-switch logic. Extracted from AskTab.tsx for size.

import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { ChatSession } from '../../types';
import { useBoardStore } from '../../store/useBoardStore';
import { CATPPUCCIN_MOCHA, CATPPUCCIN_LATTE } from './termThemes';
import { createBellFilter, playBeep, flashTerminal, type BellFilter } from './bellFilter';

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

/** Returns true when the Tauri physical-pixel position falls inside el's CSS rect. */
function dropIsInsideEl(pos: { x: number; y: number } | undefined, el: HTMLElement): boolean {
  if (pos === undefined) return true; // no position info — allow
  const dpr = window.devicePixelRatio || 1;
  const cssX = pos.x / dpr;
  const cssY = pos.y / dpr;
  const r = el.getBoundingClientRect();
  return cssX >= r.left && cssX <= r.right && cssY >= r.top && cssY <= r.bottom;
}

/** Shell-quote a list of absolute paths (single-quote; escape embedded quotes). */
function shellQuotePaths(paths: string[]): string {
  return paths.map((p) => (p.includes(' ') ? `'${p.replace(/'/g, "'\\''")}'` : p)).join(' ');
}

/** Derive a shell session's repo base name + display title (override wins). */
function shellSessionNames(
  rootDirectory: string | null,
  titleOverride?: string,
): { baseName: string; title: string } {
  const baseName = rootDirectory ? (rootDirectory.split('/').pop() ?? 'shell') : 'shell';
  const title = titleOverride ?? (rootDirectory ? `Shell · ${baseName}` : 'Shell');
  return { baseName, title };
}

interface DragDropCtx {
  el: HTMLElement | null;
  displayedId: string | null;
  termFocus: () => void;
}

type DragPayload = {
  type: string;
  position?: { x: number; y: number };
  paths?: string[];
};

/** Handles a Tauri drag-drop event for the terminal container. */
/** Toggles the drag-hover ring class; returns true if the event was a hover/leave. */
function applyDragHover(type: string, el: HTMLElement | null): boolean {
  if (type === 'over' || type === 'enter') {
    el?.classList.add('drag-over-ring');
    return true;
  }
  if (type === 'leave' || type === 'cancelled') {
    el?.classList.remove('drag-over-ring');
    return true;
  }
  return false;
}

/** Writes dropped paths into the active PTY stdin. */
function commitDrop(payload: DragPayload, ctx: DragDropCtx): void {
  const { el, displayedId } = ctx;
  if (el === null || displayedId === null) return;
  if (!dropIsInsideEl(payload.position, el)) return;
  const paths = payload.paths ?? [];
  if (paths.length === 0) return;
  void invoke('pty_write', { id: displayedId, data: shellQuotePaths(paths) + ' ' }).catch(
    () => undefined,
  );
  ctx.termFocus();
}

/** Dispatches a Tauri drag-drop event to the terminal container. */
function handleDragDrop(payload: DragPayload, ctx: DragDropCtx): void {
  if (applyDragHover(payload.type, ctx.el)) return;
  if (payload.type !== 'drop') return;
  ctx.el?.classList.remove('drag-over-ring');
  commitDrop(payload, ctx);
}

interface UseAskTerminalOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  setActiveSessionId: (id: string | null) => void;
  setSpawnError: (err: string | null) => void;
  setQuestion: (q: string) => void;
  addChatSession: (s: ChatSession) => void;
  updateChatSessionStatus: (id: string, status: 'ended', code: number | null) => void;
  setPaletteOpen: (open: boolean) => void;
  /** Called when the xterm Terminal gains focus (click or programmatic). Use
   *  this to close overlaying menus without relying on React onClick, which is
   *  unreliable on the raw xterm canvas. Only fires when activeSessionId is
   *  non-null (a session is displayed). */
  onTerminalFocus?: () => void;
  /** True when the Ask tab is the active (visible) tab. Used to refit the
   *  terminal after the parent container transitions out of display:none —
   *  ResizeObserver does not fire when a hidden element becomes visible if its
   *  reported size is unchanged from before it was hidden. */
  isVisible?: boolean;
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
  startShell: (opts?: { title?: string }) => Promise<string | null>;
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
  onTerminalFocus,
  isVisible,
}: UseAskTerminalOptions): UseAskTerminalResult {
  const terminalTheme = useBoardStore((s) => s.settings.terminalTheme);
  const terminalDefaultModel = useBoardStore((s) => s.settings.terminalDefaultModel);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Keep the latest onTerminalFocus callback in a ref so ensureTerminal's
  // useCallback never needs it in its dependency array.
  const onTerminalFocusRef = useRef<(() => void) | undefined>(onTerminalFocus);
  useEffect(() => {
    onTerminalFocusRef.current = onTerminalFocus;
  });
  // Which session's output is currently rendered in the terminal.
  const displayedIdRef = useRef<string | null>(null);
  // Accumulated raw output per session (for buffer replay on switch).
  const buffersRef = useRef<Map<string, string>>(new Map());
  // Event unlisten fns keyed by session id.
  const unlistenersRef = useRef<Map<string, UnlistenFn[]>>(new Map());
  // Pending quick-action sequencing timers, keyed by session id, so they can be
  // cancelled if the session ends or the component unmounts before they fire.
  const quickActionTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());
  // Per-session OSC-safe bell stripper. Claude Code rings the terminal bell on
  // task-done; we strip the bare BEL byte from the stream (so xterm/webview
  // never beeps) and raise our own opt-in notification instead.
  const bellFiltersRef = useRef<Map<string, BellFilter>>(new Map());

  // Audio beep and/or border flash on a terminal bell, gated by user settings.
  const notifyBell = useCallback(() => {
    const { bellAudioEnabled, bellVisualEnabled } = useBoardStore.getState().settings;
    if (bellAudioEnabled) playBeep();
    if (bellVisualEnabled) flashTerminal(containerRef.current);
  }, [containerRef]);

  // Routes one PTY output chunk to the buffer + live terminal, stripping bells.
  // `notify` is false for build/shell sessions (only Claude task-done chimes).
  const pumpOutput = useCallback(
    (id: string, raw: string, notify: boolean): void => {
      let filter = bellFiltersRef.current.get(id);
      if (filter === undefined) {
        filter = createBellFilter();
        bellFiltersRef.current.set(id, filter);
      }
      const { text, bells } = filter(raw);
      buffersRef.current.set(id, (buffersRef.current.get(id) ?? '') + text);
      if (displayedIdRef.current === id) termRef.current?.write(text);
      if (notify && bells > 0) notifyBell();
    },
    [notifyBell],
  );

  // Creates the Terminal once; sets up the single onData handler that routes
  // keyboard input to whichever session is currently displayed.
  const ensureTerminal = useCallback((): Terminal | null => {
    if (termRef.current !== null) return termRef.current;
    if (containerRef.current === null) return null;
    const theme = terminalTheme === 'latte' ? CATPPUCCIN_LATTE : CATPPUCCIN_MOCHA;
    const term = new Terminal({
      fontSize: 12.5,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, 'Courier New', monospace",
      cursorBlink: true,
      theme,
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
    // Close any open menus when the user clicks into the terminal. React onClick
    // on the container is unreliable because xterm consumes pointer events on its
    // canvas — listening on the underlying textarea focus is the correct intercept.
    const onFocusHandler = () => {
      if (displayedIdRef.current !== null) onTerminalFocusRef.current?.();
    };
    term.textarea?.addEventListener('focus', onFocusHandler);
    termRef.current = term;
    fitRef.current = fit;
    return term;
  }, [containerRef, terminalTheme]);

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
        pumpOutput(id, e.payload.data, true);
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
          model: terminalDefaultModel,
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
      pumpOutput,
      terminalDefaultModel,
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
        pumpOutput(id, e.payload.data, false);
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
      pumpOutput,
    ],
  );

  // Spawns an independent interactive login shell. Kind = 'shell' so sidebar
  // renders it with a distinct icon. Always enabled — no repo selection needed.
  const startShell = useCallback(
    async (opts?: { title?: string }): Promise<string | null> => {
      if (containerRef.current === null) return null;
      setSpawnError(null);

      const rootDirectory = useBoardStore.getState().settings.rootDirectory;
      const id = crypto.randomUUID();
      const { baseName, title } = shellSessionNames(rootDirectory, opts?.title);

      const session: ChatSession = {
        id,
        repoPath: rootDirectory ?? '',
        repoName: baseName,
        title,
        startedAt: Date.now(),
        status: 'running',
        exitCode: null,
        kind: 'shell',
      };

      addChatSession(session);
      useBoardStore.getState().logActivity({
        id: crypto.randomUUID(),
        ts: Date.now(),
        kind: 'ask_session_started',
        repoName: baseName,
      });
      buffersRef.current.set(id, '');

      const term = ensureTerminal()!;
      term.reset();
      displayedIdRef.current = id;
      setActiveSessionId(id);

      const unOut = await listen<PtyOutput>('pty-output', (e) => {
        if (e.payload.id !== id) return;
        pumpOutput(id, e.payload.data, false);
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
        await invoke('pty_spawn_shell', {
          id,
          cwd: rootDirectory ?? '',
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

      return id;
    },
    [
      containerRef,
      setSpawnError,
      addChatSession,
      ensureTerminal,
      setActiveSessionId,
      updateChatSessionStatus,
      switchToSession,
      pumpOutput,
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

  // Drag-and-drop: Tauri's webview captures native drag events (HTML5 onDrop
  // never fires when dragDropEnabled=true, the default). On drop, write the
  // absolute path(s) into the active PTY stdin — no \r so the user can review.
  // Paths with spaces are single-quoted (matches Terminal.app behaviour).
  // A subtle ring is toggled on the container while files are hovering over it.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        handleDragDrop(event.payload as DragPayload, {
          el: containerRef.current,
          displayedId: displayedIdRef.current,
          termFocus: () => termRef.current?.focus(),
        });
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [containerRef]);

  // Refit when the Ask tab becomes visible again after being hidden (display:none).
  // ResizeObserver does not fire in that transition when the container's reported
  // size happens to equal its pre-hidden size, so the terminal's col/row count
  // stays stale and text overflows / disappears. We use requestAnimationFrame so
  // the browser has finished painting the newly-visible layout before we measure.
  useEffect(() => {
    if (!isVisible) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (term === null || fit === null) return;
    const el = containerRef.current;
    if (el === null) return;
    requestAnimationFrame(() => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      fit.fit();
      const id = displayedIdRef.current;
      if (id !== null)
        void invoke('pty_resize', { id, cols: term.cols, rows: term.rows }).catch(() => undefined);
    });
  }, [isVisible, containerRef]);

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
    startShell,
    handleRunBuild,
    stopSession,
    handlePaletteSelect,
    handleInsert,
  };
}
