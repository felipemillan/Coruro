// repoStats.ts — pure derivation of everything a RepoCard renders.
// No React, no IO. Single source of card-display data so components stay dumb.

import type { Repo } from '../types';

/** One cell in the card's 3-stat grid. */
export interface CardStat {
  value: string;
  label: string;
}

/** Everything a card needs, derived from a Repo. */
export interface CardData {
  name: string;
  handle: string | null;
  description: string | null;
  tags: string[];
  language: string | null;
  isLocalOnly: boolean;
  displayStats: CardStat[];
  stale: boolean;
  sync: { dirty: boolean; ahead: number; behind: number; ciStatus: string };
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
}

const STALE_DAYS = 90;

/** Extract `@owner` from a github remote URL, or null when unparseable. */
export function parseHandle(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) return null;
  // ssh: git@github.com:owner/repo(.git)?  |  https: https://host/owner/repo(.git)?
  const ssh = remoteUrl.match(/^[^@]+@[^:]+:([^/]+)\/[^/]+?(?:\.git)?$/);
  if (ssh) return `@${ssh[1]}`;
  const https = remoteUrl.match(/^https?:\/\/[^/]+\/([^/]+)\/[^/]+?(?:\.git)?$/);
  if (https) return `@${https[1]}`;
  return null;
}

/** Compact relative age like "3d" / "5h" / "2w" from an ISO timestamp. */
export function relativeAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.max(0, (now - then) / 1000);
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d`;
  if (sec < 2629800) return `${Math.floor(sec / 604800)}w`;
  return `${Math.floor(sec / 2629800)}mo`;
}

/** Derive all card-display data from a repo. `now` is injectable for tests. */
export function deriveCardData(repo: Repo, now: number = Date.now()): CardData {
  const gh = repo.gh ?? null;
  const isLocalOnly = gh === null;

  const displayStats: CardStat[] = [
    { value: String(repo.commitCount ?? 0), label: 'COMMITS' },
    { value: String(repo.branchCount ?? 0), label: 'BRANCHES' },
    { value: relativeAge(repo.lastCommitAt ?? gh?.pushedAt, now) || '—', label: 'LAST' },
  ];

  const staleSource = gh?.pushedAt ?? repo.lastCommitAt ?? null;
  const stale =
    staleSource !== null &&
    !Number.isNaN(new Date(staleSource).getTime()) &&
    (now - new Date(staleSource).getTime()) / 86400000 > STALE_DAYS;

  return {
    name: repo.name,
    handle: parseHandle(repo.remoteUrl),
    description: repo.aiSummary ?? gh?.description ?? null,
    tags: repo.aiTags ?? gh?.topics ?? [],
    language: gh?.language ?? null,
    isLocalOnly,
    displayStats,
    stale,
    sync: {
      dirty: repo.dirty,
      ahead: repo.ahead ?? 0,
      behind: repo.behind ?? 0,
      ciStatus: gh?.ciStatus ?? 'none',
    },
    isPrivate: gh?.isPrivate ?? false,
    isFork: gh?.fork ?? false,
    isArchived: gh?.archived ?? false,
  };
}
