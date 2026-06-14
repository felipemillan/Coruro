// GhOverviewBand.tsx — GitHub metadata strip shown below the modal header.

import { ExternalLink, Star, Tag, Eye, CircleDot } from 'lucide-react';
import { safeOpenUrl } from '../../utils/openUrl';
import type { Repo } from '../../types';

/** Compact relative age like "3d"/"5h"/"2w" from an ISO timestamp; '' when empty/bad. */
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

/** Format a GitHub repo size (KB) as "N KB" or "N.N MB". */
function formatSize(kb: number): string {
  return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

type GhData = NonNullable<Repo['gh']>;

function CiStatus({ status }: { status: GhData['ciStatus'] }) {
  if (status === 'none') return null;
  const cls =
    status === 'success'
      ? 'text-sage flex items-center gap-1'
      : status === 'failure'
        ? 'text-terracotta flex items-center gap-1'
        : 'text-amber-500 flex items-center gap-1';
  return (
    <span className={cls}>
      <CircleDot size={12} strokeWidth={2} />
      CI {status}
    </span>
  );
}

function TopicChips({ topics }: { topics: string[] }) {
  if (topics.length === 0) return null;
  return (
    <span className="flex items-center gap-1 flex-wrap">
      {topics.slice(0, 5).map((t) => (
        <span
          key={t}
          className="px-1.5 py-0.5 bg-sage/15 text-sage text-[10px] font-mono rounded-full"
        >
          {t}
        </span>
      ))}
    </span>
  );
}

function FeatureChips({ gh }: { gh: GhData }) {
  if (!gh.hasIssues && !gh.hasWiki && !gh.hasPages) return null;
  return (
    <span className="flex items-center gap-1">
      {gh.hasIssues && (
        <span className="px-1.5 py-0.5 bg-sage/15 text-sage text-[10px] font-mono rounded-full">
          issues
        </span>
      )}
      {gh.hasWiki && (
        <span className="px-1.5 py-0.5 bg-sage/15 text-sage text-[10px] font-mono rounded-full">
          wiki
        </span>
      )}
      {gh.hasPages && (
        <span className="px-1.5 py-0.5 bg-sage/15 text-sage text-[10px] font-mono rounded-full">
          pages
        </span>
      )}
    </span>
  );
}

/** Optional tail: disabled badge, fork origin, homepage link, feature chips. */
function GhTail({ gh }: { gh: GhData }) {
  return (
    <>
      {gh.disabled && (
        <span className="px-1.5 py-0.5 bg-navy/10 text-navy-light text-[10px] rounded-full">
          disabled
        </span>
      )}
      {gh.fork && gh.parent && (
        <button
          type="button"
          onClick={() => void safeOpenUrl(gh.parent!.url)}
          className="text-sage hover:underline cursor-pointer"
          title="Open upstream repository"
        >
          fork of {gh.parent.fullName}
        </button>
      )}
      {gh.homepage && (
        <button
          type="button"
          onClick={() => void safeOpenUrl(gh.homepage!)}
          className="flex items-center gap-1 text-sage hover:underline cursor-pointer"
          title={gh.homepage}
        >
          <ExternalLink size={12} strokeWidth={1.75} />
          homepage
        </button>
      )}
      <FeatureChips gh={gh} />
    </>
  );
}

function GhDetails({ gh }: { gh: GhData }) {
  return (
    <>
      {gh.htmlUrl && (
        <button
          type="button"
          onClick={() => void safeOpenUrl(gh.htmlUrl!)}
          className="flex items-center gap-1 text-sage hover:underline cursor-pointer font-medium"
          title={gh.htmlUrl}
        >
          <ExternalLink size={13} strokeWidth={1.75} />
          GitHub
        </button>
      )}
      {gh.description && <span className="text-navy truncate max-w-[40%]">{gh.description}</span>}
      {gh.language && <span className="font-mono">{gh.language}</span>}
      {gh.license && <span className="font-mono">{gh.license}</span>}
      <span className="flex items-center gap-1">
        <Star size={12} strokeWidth={1.75} />
        {gh.stars}
      </span>
      <span className="font-mono">⑂ {gh.forks}</span>
      <span title="Open issues">{gh.openIssues} issues</span>
      <span title="Open PRs">{gh.prCount} PRs</span>
      <CiStatus status={gh.ciStatus} />
      {gh.latestRelease && (
        <span className="flex items-center gap-1 font-mono">
          <Tag size={12} strokeWidth={1.75} />
          {gh.latestRelease.tag}
        </span>
      )}
      <TopicChips topics={gh.topics} />
      <span className="flex items-center gap-1" title="Watchers">
        <Eye size={12} strokeWidth={1.75} />
        {gh.watchers}
      </span>
      {relativeAge(gh.updatedAt) && (
        <span title={`Updated ${gh.updatedAt}`}>updated {relativeAge(gh.updatedAt)}</span>
      )}
      <span className="font-mono">{formatSize(gh.size)}</span>
      <span className="font-mono">branch: {gh.defaultBranch}</span>
      <GhTail gh={gh} />
    </>
  );
}

interface GhOverviewBandProps {
  repo: Repo;
}

export function GhOverviewBand({ repo }: GhOverviewBandProps) {
  return (
    <div className="shrink-0 px-5 py-2.5 bg-cream/60 border-b border-warm-gray text-[12px] text-navy-light flex items-center gap-3 flex-wrap min-h-[40px] rounded-xl mx-2 mt-1.5 mb-0">
      {repo.gh ? (
        <GhDetails gh={repo.gh} />
      ) : (
        <span className="italic text-navy-light/50">
          No GitHub data (local-only or no github.com remote).
        </span>
      )}
    </div>
  );
}
