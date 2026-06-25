// RepoCard.tsx — editorial information-dashboard card for one repository.
//
// Composes: CardHeader (lang tint + sync glance), an identity block
// (handle / name / description / tags), an adaptive StatGrid, and an action
// row. All display data is derived by repoStats; this file wires behavior.
//
// AI-ready: description renders repo.aiSummary when present (else GitHub
// description); tags render repo.aiTags when present (else GitHub topics).
// Both are produced by deriveCardData — later AI cycles just populate fields.

import { memo, useState, useRef, useEffect } from 'react';
import {
  Code2,
  FolderOpen,
  FileText,
  ExternalLink,
  SquareTerminal,
  Lock,
  GitFork,
  Archive,
  Pencil,
  RotateCcw,
  Check,
  X,
} from 'lucide-react';
import { Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { safeOpenUrl } from '../utils/openUrl';
import { useBoardStore } from '../store/useBoardStore';
import { useViewStore } from '../store/useViewStore';
import { deriveCardData } from '../utils/repoStats';
import { CardHeader } from './card/CardHeader';
import { StatGrid } from './card/StatGrid';
import type { Repo } from '../types';

interface RepoCardProps {
  repo: Repo;
  selected?: boolean;
}

function RepoCardImpl({ repo, selected = false }: RepoCardProps) {
  const editorCommand = useBoardStore((s) => s.settings.editorCommand);
  const editorApp = useBoardStore((s) => s.settings.editorApp);
  const customName = useBoardStore((s) => s.repoMetadata[repo.path]?.customName);
  const setRepoCustomName = useBoardStore((s) => s.setRepoCustomName);
  const setDetail = useViewStore((s) => s.setDetail);
  const requestAsk = useViewStore((s) => s.requestAsk);

  const [openError, setOpenError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  const d = deriveCardData(repo, undefined, { customName });
  const htmlUrl = repo.gh?.htmlUrl ?? null;
  const hasCustomName = customName !== undefined && customName !== repo.name;

  function startEdit() {
    setDraftName(d.name);
    setIsEditing(true);
  }

  function saveName() {
    const trimmed = draftName.trim();
    setRepoCustomName(repo.path, trimmed.length > 0 ? trimmed : null);
    setIsEditing(false);
  }

  function cancelEdit() {
    setIsEditing(false);
  }

  async function openInEditor() {
    setOpenError(null);
    try {
      await invoke('open_in_editor', { command: editorCommand, app: editorApp, path: repo.path });
    } catch (e: unknown) {
      setOpenError(e instanceof Error ? e.message : String(e));
    }
  }

  async function revealInFinder() {
    await Command.create('open', ['--', repo.path]).execute();
  }

  const iconBtn =
    'p-1 rounded-full text-navy-light hover:text-sage hover:bg-navy/8 transition-colors';

  return (
    <article
      className={[
        'nb-card nb-hover bg-white flex flex-col overflow-hidden',
        d.stale ? 'opacity-70' : '',
        selected ? 'border-sage ring-2 ring-sage' : '',
      ].join(' ')}
      data-path={repo.path}
    >
      <CardHeader name={d.name} language={d.language} sync={d.sync} />

      {/* Identity block */}
      <div className="px-3 pt-2 pb-2 flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {d.handle && (
              <p className="text-[10px] font-bold tracking-wider text-navy-light uppercase truncate">
                {d.handle}
              </p>
            )}
            {isEditing ? (
              <div className="flex items-center gap-1 mt-0.5">
                <input
                  ref={inputRef}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  className="flex-1 text-navy font-bold text-base leading-tight tracking-tight border border-sage rounded px-1 py-0.5 outline-none min-w-0"
                  aria-label="Edit project name"
                />
                <button
                  type="button"
                  onClick={saveName}
                  className="p-0.5 text-sage hover:text-sage/80"
                  aria-label="Save name"
                >
                  <Check size={13} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="p-0.5 text-navy-light hover:text-terracotta"
                  aria-label="Cancel edit"
                >
                  <X size={13} strokeWidth={2} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1 group/name">
                <h3
                  className="text-navy font-bold text-base leading-tight tracking-tight break-words"
                  title={repo.path}
                >
                  {d.name}
                </h3>
                <button
                  type="button"
                  onClick={startEdit}
                  className="opacity-0 group-hover/name:opacity-100 p-0.5 text-navy-light hover:text-sage transition-opacity"
                  aria-label="Rename project"
                >
                  <Pencil size={11} strokeWidth={2} />
                </button>
                {hasCustomName && (
                  <button
                    type="button"
                    onClick={() => setRepoCustomName(repo.path, null)}
                    className="opacity-0 group-hover/name:opacity-100 p-0.5 text-navy-light hover:text-terracotta transition-opacity"
                    title={`Reset to original: ${repo.name}`}
                    aria-label="Reset to original name"
                  >
                    <RotateCcw size={11} strokeWidth={2} />
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0 text-navy-light">
            {d.isPrivate && <Lock size={12} strokeWidth={2} aria-label="Private" />}
            {d.isFork && <GitFork size={12} strokeWidth={2} aria-label="Fork" />}
            {d.isArchived && <Archive size={12} strokeWidth={2} aria-label="Archived" />}
          </div>
        </div>

        {d.description && (
          <p className="text-[12px] text-navy leading-snug border-l-2 border-terracotta pl-2 line-clamp-2">
            {d.description}
          </p>
        )}

        {d.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {d.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="text-[9px] font-medium px-1.5 py-0.5 bg-dusty-pink/30 text-navy-light rounded-full leading-none"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <StatGrid stats={d.displayStats} />

      {openError !== null && (
        <p className="text-[11px] text-terracotta leading-snug px-3 py-1" role="alert">
          {openError}
        </p>
      )}

      {/* Action row */}
      <div className="flex items-center justify-end gap-1 border-t border-navy/10 px-2 py-1">
        {htmlUrl && (
          <button
            type="button"
            onClick={() => {
              void safeOpenUrl(htmlUrl);
            }}
            className={iconBtn}
            title="Open on GitHub"
            aria-label="Open repository on GitHub"
          >
            <ExternalLink size={14} strokeWidth={1.75} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setDetail(repo.path)}
          className={iconBtn}
          title="View README & files"
          aria-label="View README and files"
        >
          <FileText size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => {
            void openInEditor();
          }}
          className={iconBtn}
          title={`Open in IDE (${editorCommand || editorApp})`}
          aria-label="Open in IDE"
        >
          <Code2 size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => requestAsk(repo.path)}
          className={iconBtn}
          title="Ask Claude Code about this repo"
          aria-label="Ask Claude Code"
        >
          <SquareTerminal size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => {
            void revealInFinder();
          }}
          className={iconBtn}
          title="Reveal in Finder"
          aria-label="Reveal in Finder"
        >
          <FolderOpen size={14} strokeWidth={1.75} />
        </button>
      </div>
    </article>
  );
}

// Memoized: Board re-renders on every search keystroke / store change. With a
// stable `repo` identity per scan cycle, shallow prop equality skips
// reconciliation of every visible card whose props are unchanged.
export const RepoCard = memo(RepoCardImpl);
