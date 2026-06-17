// AskTab — "ask your repos": hosts real interactive Claude Code sessions
// inside the app via a PTY (xterm.js ↔ pty.rs).
//
// A left sidebar lists all sessions grouped by repo. A single Terminal
// instance is reused — switching replays the accumulated output buffer.

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import '@xterm/xterm/css/xterm.css';
import { useBoardStore } from '../store/useBoardStore';
import { useViewStore } from '../store/useViewStore';
import { CommandPalette } from './CommandPalette';
import type { ChatSession } from '../types';
import { AskSidebar } from './ask/AskSidebar';
import { AskTerminalPanel } from './ask/AskTerminalPanel';
import { fmtTime } from './ask/askUtils';
import { useAskTerminal } from './ask/useAskTerminal';

/** Undo window (ms) for an inline session delete before teardown is finalized. */
const DELETE_UNDO_MS = 6000;

interface AskTabProps {
  /** True when the Ask tab is the currently active (visible) tab. Forwarded to
   *  useAskTerminal so it can refit the terminal after the display:none wrapper
   *  becomes visible again. */
  isVisible: boolean;
}

export function AskTab({ isVisible }: AskTabProps) {
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
  const [repoDetection, setRepoDetection] = useState<{ repoType: string; label: string } | null>(
    null,
  );
  // Inline-delete undo toast: holds the pending-delete id + label, else null.
  const [deleteToast, setDeleteToast] = useState<{ id: string; label: string } | null>(null);
  // The pinned "Github" root-dir shell session id (created on first open).
  const [githubShellId, setGithubShellId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const newBtnRef = useRef<HTMLButtonElement | null>(null);
  // Ref written by TopActionBar so we can call closeAll from outside (task #5).
  const closeAllMenusRef = useRef<(() => void) | null>(null);
  // Sessions deleted but inside the undo window: stash the full session + its
  // expiry timer so Undo can restore the row (and keep a running PTY alive).
  const pendingDeletesRef = useRef<
    Map<string, { session: ChatSession; timer: ReturnType<typeof setTimeout> }>
  >(new Map());

  const {
    termRef,
    displayedIdRef,
    quickActionTimersRef,
    unlistenersRef,
    buffersRef,
    switchToSession,
    start,
    startShell,
    handleRunBuild,
    stopSession,
    handlePaletteSelect,
    handleInsert,
  } = useAskTerminal({
    containerRef,
    setActiveSessionId,
    setSpawnError,
    setQuestion,
    addChatSession,
    updateChatSessionStatus,
    setPaletteOpen,
    onTerminalFocus: () => closeAllMenusRef.current?.(),
    isVisible,
  });

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
    if (repoPath === '' || repoPath === rootDirectory) {
      setRepoDetection(null);
      return;
    }
    invoke<{ repoType: string; label: string }>('detect_repo_type', { path: repoPath })
      .then((d) => setRepoDetection(d.repoType !== 'Unknown' ? d : null))
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

  // Command Center quick-action: pre-fill cwd + prompt for the UI, then launch
  // immediately via an explicit override so we never depend on a state commit.
  useEffect(() => {
    if (pendingAskCommand !== null) {
      const { cwd, prompt } = pendingAskCommand;
      setRepoPath(cwd);
      setQuestion(prompt);
      clearPendingAskCommand();
      void start({ cwd, prompt }, cwd, prompt, getRepoName);
    }
  }, [pendingAskCommand, clearPendingAskCommand, start, getRepoName]);

  // Finalize an inline delete after the undo window lapses: ordered teardown so
  // nothing leaks. Kill is deferred to here (NOT at delete time) so a running
  // PTY survives the undo window and can be restored. A late pty-exit for this
  // id is a harmless no-op (the store entry is already gone, listeners detached).
  const finalizeDelete = useCallback(
    (id: string) => {
      void invoke('pty_kill', { id }).catch(() => undefined); // dead/unknown id no-ops
      quickActionTimersRef.current.get(id)?.forEach((t) => clearTimeout(t));
      quickActionTimersRef.current.delete(id);
      unlistenersRef.current.get(id)?.forEach((u) => u());
      unlistenersRef.current.delete(id);
      buffersRef.current.delete(id);
      pendingDeletesRef.current.delete(id);
      setDeleteToast((t) => (t?.id === id ? null : t));
    },
    [quickActionTimersRef, unlistenersRef, buffersRef],
  );

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
    [
      deleteToast,
      finalizeDelete,
      sessions,
      switchToSession,
      deleteChatSession,
      displayedIdRef,
      termRef,
    ],
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

  // Pending deletes cleanup on unmount.
  useEffect(() => {
    return () => {
      for (const { timer } of pendingDeletesRef.current.values()) clearTimeout(timer);
      pendingDeletesRef.current.clear();
    };
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Pinned "Github" entry: focus the existing root-dir shell if alive, else
  // start a fresh one rooted at the root scan dir and remember its id.
  const openGithubShell = useCallback(() => {
    if (githubShellId !== null && sessions.some((s) => s.id === githubShellId)) {
      switchToSession(githubShellId);
      return;
    }
    void startShell({ title: 'Github' }).then((id) => {
      if (id !== null) setGithubShellId(id);
    });
  }, [githubShellId, sessions, switchToSession, startShell]);

  const githubShellRunning =
    githubShellId !== null && sessions.find((s) => s.id === githubShellId)?.status === 'running';

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
        <AskSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          deleteToast={deleteToast}
          githubShellId={githubShellId}
          githubShellRunning={githubShellRunning}
          onOpenGithubShell={openGithubShell}
          onStartShell={() => void startShell()}
          onStartClaude={() => void start(undefined, repoPath, question, getRepoName)}
          onSelectSession={switchToSession}
          onDeleteSession={requestDelete}
          onUndoDelete={undoDelete}
        />

        {/* ── Right panel ─────────────────────────────── */}
        <AskTerminalPanel
          repoPath={repoPath}
          rootDirectory={rootDirectory}
          sorted={sorted}
          question={question}
          spawnError={spawnError}
          activeSession={activeSession}
          activeSessionId={activeSessionId}
          repoDetection={repoDetection}
          containerRef={containerRef}
          onRepoChange={setRepoPath}
          onQuestionChange={setQuestion}
          onStart={() => void start(undefined, repoPath, question, getRepoName)}
          onStop={stopSession}
          onRunBuild={() =>
            repoDetection !== null
              ? void handleRunBuild(repoDetection, repoPath, getRepoName)
              : undefined
          }
          onOpenPalette={() => setPaletteOpen(true)}
          onInsert={handleInsert}
          getRepoName={getRepoName}
          newBtnRef={newBtnRef}
          closeAllMenusRef={closeAllMenusRef}
        />
      </div>
    </>
  );
}
