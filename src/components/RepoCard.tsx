// RepoCard.tsx — Kanban card for a single repository.
//
// Displays: repo name, current branch, dirty/clean badge, open PR count,
// per-repo notes textarea (debounced via store.updateNotes), and two icon
// buttons for VS Code and Finder.
//
// Design contract: rounded-none, indie pastel / Wes Anderson palette.
// Arg arrays only — no shell string interpolation.

import { useState } from 'react';
import { Code2, FolderOpen, FileText } from 'lucide-react';
import { Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { useBoardStore } from '../store/useBoardStore';
import { RepoDetail } from './RepoDetail';
import type { Repo } from '../types';

interface RepoCardProps {
  repo: Repo;
}

export function RepoCard({ repo }: RepoCardProps) {
  const updateNotes = useBoardStore((s) => s.updateNotes);
  const notes = useBoardStore(
    (s) => s.repoMetadata[repo.path]?.notes ?? '',
  );
  const editorCommand = useBoardStore((s) => s.settings.editorCommand);
  const editorApp = useBoardStore((s) => s.settings.editorApp);

  const [detailOpen, setDetailOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  async function openInEditor() {
    setOpenError(null);
    try {
      // Rust tries the CLI command first, then falls back to `open -a <app>`.
      await invoke('open_in_editor', {
        command: editorCommand,
        app: editorApp,
        path: repo.path,
      });
    } catch (e: unknown) {
      setOpenError(e instanceof Error ? e.message : String(e));
    }
  }

  async function revealInFinder() {
    await Command.create('open', ['--', repo.path]).execute();
  }

  function handleNotesChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    updateNotes(repo.path, e.target.value);
  }

  return (
    <article
      className="bg-warm-gray border border-navy/10 p-3 flex flex-col gap-2 shadow-sm"
      data-path={repo.path}
    >
      {/* ── Header row: name + action buttons ── */}
      <div className="flex items-start justify-between gap-2">
        <h3
          className="text-navy font-semibold text-sm leading-tight break-all"
          title={repo.path}
        >
          {repo.name}
        </h3>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="p-1 text-navy-light hover:text-sage transition-colors"
            title="View README & files"
            aria-label="View README and files"
          >
            <FileText size={14} strokeWidth={1.75} />
          </button>

          <button
            type="button"
            onClick={() => { void openInEditor(); }}
            className="p-1 text-navy-light hover:text-sage transition-colors"
            title={`Open in editor (${editorCommand || editorApp})`}
            aria-label="Open in editor"
          >
            <Code2 size={14} strokeWidth={1.75} />
          </button>

          <button
            type="button"
            onClick={() => { void revealInFinder(); }}
            className="p-1 text-navy-light hover:text-sage transition-colors"
            title="Reveal in Finder"
            aria-label="Reveal in Finder"
          >
            <FolderOpen size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Editor-launch error (e.g. CLI not found + wrong app name) */}
      {openError !== null && (
        <p className="text-[11px] text-terracotta leading-snug" role="alert">
          {openError}
        </p>
      )}

      {detailOpen && (
        <RepoDetail repo={repo} onClose={() => setDetailOpen(false)} />
      )}

      {/* ── Meta row: branch + dirty badge + PR count ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Branch name */}
        <span className="text-navy-light text-xs font-mono truncate max-w-[120px]">
          {repo.branch}
        </span>

        {/* Dirty / clean badge */}
        <span
          className={[
            'text-xs px-1.5 py-0.5 font-medium leading-none',
            repo.dirty
              ? 'bg-terracotta/20 text-terracotta'
              : 'bg-sage/20 text-sage',
          ].join(' ')}
          aria-label={repo.dirty ? 'Uncommitted changes' : 'Working tree clean'}
        >
          {repo.dirty ? 'dirty' : 'clean'}
        </span>

        {/* Open PR count — only shown when > 0 */}
        {repo.prCount > 0 && (
          <span
            className="text-xs px-1.5 py-0.5 bg-dusty-pink/30 text-navy-light font-medium leading-none"
            aria-label={`${repo.prCount} open pull request${repo.prCount === 1 ? '' : 's'}`}
          >
            {repo.prCount} PR{repo.prCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* ── Notes textarea ── */}
      <textarea
        value={notes}
        onChange={handleNotesChange}
        placeholder="Notes…"
        rows={2}
        className={[
          'w-full resize-none text-xs text-navy-light',
          'bg-cream/60 border border-navy/10',
          'px-2 py-1.5 placeholder:text-navy/30',
          'focus:outline-none focus:border-sage/60 focus:bg-cream',
          'transition-colors',
        ].join(' ')}
        aria-label={`Notes for ${repo.name}`}
      />
    </article>
  );
}
