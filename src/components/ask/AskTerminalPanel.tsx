// AskTerminalPanel — right-side panel: controls row, TopActionBar, and
// the xterm.js terminal area. Extracted from AskTab.tsx for size.

import { type RefObject } from 'react';
import { Plus, Square, SquareTerminal } from 'lucide-react';
import { TopActionBar } from '../TopActionBar';
import type { ChatSession } from '../../types';

interface AskTerminalPanelProps {
  repoPath: string;
  rootDirectory: string | null;
  sorted: { path: string; name: string }[];
  question: string;
  spawnError: string | null;
  activeSession: ChatSession | undefined;
  activeSessionId: string | null;
  repoDetection: { repoType: string; label: string } | null;
  containerRef: RefObject<HTMLDivElement | null>;
  onRepoChange: (path: string) => void;
  onQuestionChange: (q: string) => void;
  onStart: () => void;
  onStop: (id: string) => void;
  onRunBuild: () => void;
  onOpenPalette: () => void;
  onInsert: (text: string) => void;
  getRepoName: (path: string) => string;
  newBtnRef: RefObject<HTMLButtonElement | null>;
}

export function AskTerminalPanel({
  repoPath,
  rootDirectory,
  sorted,
  question,
  spawnError,
  activeSession,
  activeSessionId,
  repoDetection,
  containerRef,
  onRepoChange,
  onQuestionChange,
  onStart,
  onStop,
  onRunBuild,
  onOpenPalette,
  onInsert,
  getRepoName,
  newBtnRef,
}: AskTerminalPanelProps) {
  const activeRunning = activeSession?.status === 'running';

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Controls row */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-warm-gray bg-cream/60">
        <SquareTerminal size={15} strokeWidth={1.75} className="text-sage shrink-0" />
        <select
          value={repoPath}
          onChange={(e) => onRepoChange(e.target.value)}
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
          onChange={(e) => onQuestionChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onStart();
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
            onClick={() => activeSession && onStop(activeSession.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-terracotta bg-terracotta/10 hover:bg-terracotta/20 transition-colors cursor-pointer rounded-full"
          >
            <Square size={12} strokeWidth={2} /> End
          </button>
        )}
        {/* Run/build button — shown only when we know the project type */}
        {repoDetection !== null && (
          <button
            type="button"
            onClick={onRunBuild}
            className="flex flex-col items-start px-3 py-1 text-[11px] font-medium text-sage bg-sage/10 hover:bg-sage/20 transition-colors cursor-pointer rounded-full leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
          >
            <span>Run</span>
            <span className="text-[9px] font-mono text-sage/70">{repoDetection.label}</span>
          </button>
        )}

        {/* Cmd+K palette hint badge */}
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Open command palette (⌘K)"
          className="px-2 py-1 text-[10px] font-mono text-navy-light/50 bg-warm-gray hover:bg-warm-gray/80 rounded-lg cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage"
        >
          ⌘K
        </button>

        <button
          ref={newBtnRef}
          type="button"
          onClick={onStart}
          disabled={repoPath === ''}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-cream bg-navy hover:bg-navy-light transition-colors cursor-pointer rounded-full disabled:opacity-40"
        >
          <Plus size={12} strokeWidth={2.5} /> New
        </button>
      </div>

      {/* Global action bar — insert skills/agents/commands/MCP into the prompt */}
      <TopActionBar onInsert={onInsert} disabled={activeSessionId === null} />

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
  );
}
