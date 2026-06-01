// RepoCard.tsx — Kanban card for a single repository.
//
// Displays: repo name, current branch, dirty/clean badge, GitHub badges
// (CI status, open issues, stars, latest release, private/archived), and
// three icon buttons (detail modal, editor, Finder). Notes live in the
// detail modal's timeline.
//
// Design contract: rounded-none, indie pastel / Wes Anderson palette.
// Arg arrays only — no shell string interpolation.

import { useState } from 'react';
import { Code2, FolderOpen, FileText, Star, CircleDot, Tag, Eye, ExternalLink, TerminalSquare } from 'lucide-react';
import { Command } from '@tauri-apps/plugin-shell';
import { safeOpenUrl } from '../utils/openUrl';
import { invoke } from '@tauri-apps/api/core';
import { useBoardStore } from '../store/useBoardStore';
import { RepoDetail } from './RepoDetail';
import type { Repo, CiStatus } from '../types';

interface RepoCardProps {
  repo: Repo;
}

/** Compact relative age like "3d" / "5h" / "2w" from an ISO timestamp. */
function relativeAge(iso: string): string {
  if (iso === '') return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.max(0, (Date.now() - then) / 1000);
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d`;
  if (sec < 2629800) return `${Math.floor(sec / 604800)}w`;
  return `${Math.floor(sec / 2629800)}mo`;
}

/** Tailwind text color for staleness based on an ISO push date. */
function staleColor(iso: string): string {
  if (iso === '') return 'text-navy-light';
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (Number.isNaN(days)) return 'text-navy-light';
  if (days < 30) return 'text-sage';
  if (days <= 90) return 'text-navy-light';
  return 'text-amber-500';
}

/** Tailwind text color for a CI dot. Returns null when no CI to show. */
function ciColor(status: CiStatus): string | null {
  switch (status) {
    case 'success': return 'text-sage';
    case 'failure': return 'text-terracotta';
    case 'pending': return 'text-amber-500';
    case 'none': return null;
  }
}

export function RepoCard({ repo }: RepoCardProps) {
  const editorCommand = useBoardStore((s) => s.settings.editorCommand);
  const editorApp = useBoardStore((s) => s.settings.editorApp);
  const terminalApp = useBoardStore((s) => s.settings.terminalApp);

  const [detailOpen, setDetailOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  async function openInEditor() {
    setOpenError(null);
    try {
      await invoke('open_in_editor', {
        command: editorCommand,
        app: editorApp,
        path: repo.path,
      });
    } catch (e: unknown) {
      setOpenError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openInTerminal() {
    setOpenError(null);
    try {
      await invoke('open_in_terminal', {
        app: terminalApp,
        path: repo.path,
      });
    } catch (e: unknown) {
      setOpenError(e instanceof Error ? e.message : String(e));
    }
  }

  async function revealInFinder() {
    await Command.create('open', ['--', repo.path]).execute();
  }

  const gh = repo.gh ?? null;
  const ci = gh ? ciColor(gh.ciStatus) : null;

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
          {gh?.htmlUrl && (
            <button
              type="button"
              onClick={() => { if (gh.htmlUrl) void safeOpenUrl(gh.htmlUrl); }}
              className="p-1 text-navy-light hover:text-sage transition-colors"
              title="Open on GitHub"
              aria-label="Open repository on GitHub"
            >
              <ExternalLink size={14} strokeWidth={1.75} />
            </button>
          )}

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
            title={`Open in IDE (${editorCommand || editorApp})`}
            aria-label="Open in IDE"
          >
            <Code2 size={14} strokeWidth={1.75} />
          </button>

          <button
            type="button"
            onClick={() => { void openInTerminal(); }}
            className="p-1 text-navy-light hover:text-sage transition-colors"
            title={`Open in terminal (${terminalApp})`}
            aria-label="Open in terminal"
          >
            <TerminalSquare size={14} strokeWidth={1.75} />
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

      {/* Editor-launch error */}
      {openError !== null && (
        <p className="text-[11px] text-terracotta leading-snug" role="alert">
          {openError}
        </p>
      )}

      {detailOpen && (
        <RepoDetail repo={repo} onClose={() => setDetailOpen(false)} />
      )}

      {/* ── Meta row: branch + dirty badge ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-navy-light text-xs font-mono truncate max-w-[120px]">
          {repo.branch}
        </span>

        <span
          className={[
            'text-xs px-1.5 py-0.5 font-medium leading-none',
            repo.dirty ? 'bg-terracotta/20 text-terracotta' : 'bg-sage/20 text-sage',
          ].join(' ')}
          aria-label={repo.dirty ? 'Uncommitted changes' : 'Working tree clean'}
        >
          {repo.dirty ? 'dirty' : 'clean'}
        </span>

        {gh?.isPrivate && (
          <span className="text-xs px-1.5 py-0.5 bg-navy/10 text-navy-light font-medium leading-none">
            private
          </span>
        )}
        {gh?.archived && (
          <span className="text-xs px-1.5 py-0.5 bg-navy/10 text-navy-light font-medium leading-none">
            archived
          </span>
        )}
      </div>

      {/* ── GitHub badges row (only when enriched) ── */}
      {gh && (
        <div className="flex items-center gap-3 flex-wrap text-[11px] text-navy-light">
          {ci !== null && (
            <span className={`flex items-center gap-1 ${ci}`} title={`CI: ${gh.ciStatus}`}>
              <CircleDot size={11} strokeWidth={2} />
              CI
            </span>
          )}
          {gh.prCount > 0 && (
            <span className="px-1.5 py-0.5 bg-dusty-pink/30 text-navy-light font-medium leading-none">
              {gh.prCount} PR{gh.prCount === 1 ? '' : 's'}
            </span>
          )}
          {gh.openIssues > 0 && (
            <span title="Open issues">
              {gh.openIssues} issue{gh.openIssues === 1 ? '' : 's'}
            </span>
          )}
          {gh.stars > 0 && (
            <span className="flex items-center gap-0.5" title="Stars">
              <Star size={11} strokeWidth={1.75} /> {gh.stars}
            </span>
          )}
          {gh.latestRelease && (
            <span className="flex items-center gap-1 font-mono" title={`Latest release ${gh.latestRelease.tag}`}>
              <Tag size={11} strokeWidth={1.75} />
              {gh.latestRelease.tag}
              {relativeAge(gh.latestRelease.publishedAt) && ` · ${relativeAge(gh.latestRelease.publishedAt)}`}
            </span>
          )}
          {relativeAge(gh.pushedAt) && (
            <span className={staleColor(gh.pushedAt)} title={`Last push ${gh.pushedAt}`}>
              updated {relativeAge(gh.pushedAt)}
            </span>
          )}
          {gh.fork && (
            <span className="px-1.5 py-0.5 bg-navy/10 text-navy-light font-medium leading-none">
              fork
            </span>
          )}
          {gh.watchers > 0 && (
            <span className="flex items-center gap-0.5" title="Watchers">
              <Eye size={11} strokeWidth={1.75} /> {gh.watchers}
            </span>
          )}
          {gh.homepage && (
            <button
              type="button"
              onClick={() => { if (gh.homepage) void safeOpenUrl(gh.homepage); }}
              className="flex items-center gap-0.5 text-navy-light hover:text-sage transition-colors cursor-pointer"
              title={`Homepage: ${gh.homepage}`}
              aria-label="Open homepage"
            >
              <ExternalLink size={11} strokeWidth={1.75} /> site
            </button>
          )}
        </div>
      )}
    </article>
  );
}
