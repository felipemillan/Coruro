// Day-notes activity gathering.
//
// Extracted verbatim (behaviour-preserving) from generateDayNotes: for each
// runtime repo, collect local git commits, uncommitted work, GitHub API commits
// and PR titles, CI outcomes, and user events within the window. Produces both
// the human-readable context lines (numbers intact, for the deterministic report
// skeleton) and the number-free aiLines fed to the on-device sidecar.
//
// Kept as a focused module so generateDayNotes stays small. Still performs
// network/git IO (via Tauri invoke + fetch) — it is "gathering", not pure.

import { invoke } from '@tauri-apps/api/core';
import type { Repo } from '../types';
import { parseRemote } from '../utils/github';
import { formatRepoContext } from '../utils/dayNotesContext';
import type { EnrichedRepoEntry, CommitDetail } from '../utils/dayNotesContext';
import { parseDirtyStat, qualitativeDigest, type RepoActivity } from '../utils/sessionReport';
import { fetchCIOutcomes, formatCILine } from '../utils/githubCI';
import { fetchPRDetails, formatPRLine } from '../utils/githubPRDetails';
import type { ActivityEvent } from '../utils/githubEvents';
import { RateLimitError } from './boardStoreShared';

/** One repo's gathered day-notes activity. */
export interface RepoDayNotesData {
  name: string;
  /** Human-readable context lines (numbers intact) for the report skeleton. */
  commits: string[];
  /** Structured stats for the deterministic report. */
  activity: RepoActivity;
  /** Number-free lines for the AI executive summary. */
  aiLines: string[];
}

interface GatherInput {
  repos: Repo[];
  token: string | null;
  allEvents: ActivityEvent[];
  windowStart: string;
}

/**
 * Gather per-repo activity for the given window. Throws RateLimitError if the
 * GitHub API returns 429 (so the caller can show a friendly message); all other
 * per-repo failures degrade to empty/soft-miss without throwing.
 */
export async function gatherRepoDayNotesData({
  repos,
  token,
  allEvents,
  windowStart,
}: GatherInput): Promise<RepoDayNotesData[]> {
  // SHA-based dedup set shared across repos to avoid cross-repo collisions
  const seenShas = new Set<string>();
  return Promise.all(
    repos.map((r) => gatherOneRepo(r, { token, allEvents, windowStart, seenShas })),
  );
}

interface OneRepoCtx {
  token: string | null;
  allEvents: ActivityEvent[];
  windowStart: string;
  seenShas: Set<string>;
}

async function gatherOneRepo(r: Repo, ctx: OneRepoCtx): Promise<RepoDayNotesData> {
  const { token, allEvents, windowStart, seenShas } = ctx;
  // 1. Local git commits (fast, works offline) — now returns CommitDetail[]
  // windowStart is the exclusive lower bound: no commit before this timestamp
  // is ever included. computeWindow() anchors windowStart on the previous
  // note's windowEnd so there is no silent gap between runs.
  const rawCommits = await invoke<CommitDetail[]>('git_commits_since_numstat', {
    path: r.path,
    sinceIso: windowStart,
  }).catch(() => [] as CommitDetail[]);
  // Defensive: tolerate a malformed backend response rather than throwing.
  let localCommits = Array.isArray(rawCommits) ? rawCommits : [];

  // Uncommitted work summary (diff --stat vs HEAD + untracked count).
  // Backend returns '' on clean tree or any git failure — never throws.
  const dirtyStat = await invoke<string>('git_dirty_stat', { path: r.path }).catch(() => '');

  // SHA-based dedup: filter out commits already seen from other repos
  localCommits = localCommits.filter((c) => {
    if (seenShas.has(c.sha)) return false;
    seenShas.add(c.sha);
    return true;
  });

  // Extract issue refs from subjects across all local commits
  const issueRefSet = new Set<string>();
  for (const c of localCommits) {
    const matches = c.subject.matchAll(/#(\d+)/g);
    for (const m of matches) issueRefSet.add(`#${m[1]}`);
  }

  // 2. GitHub API commits + PR titles (richer, catches remote-only activity)
  const coords = r.remoteUrl ? parseRemote(r.remoteUrl) : null;
  const ciRuns =
    coords && token
      ? await fetchCIOutcomes(coords.owner, coords.repo, token, windowStart).catch(() => [])
      : [];
  const { prLines, ghCommitLines } = await gatherGitHubActivity(
    coords,
    token,
    windowStart,
    seenShas,
    issueRefSet,
  );

  // Build EnrichedRepoEntry and format with shared utility
  const entry: EnrichedRepoEntry = {
    repoName: r.name,
    commits: localCommits,
    prs: prLines,
    events: allEvents
      .filter((e) => e.repo.endsWith('/' + r.name))
      .map((e) => '[event] ' + e.summary),
    ciLines: ciRuns.map(formatCILine),
  };
  const contextLines = buildContextLines(entry, issueRefSet, ghCommitLines, dirtyStat);
  const activity = computeActivity(r.name, localCommits, dirtyStat);
  const aiLines = buildAiLines(entry, activity, r.branch);

  return { name: r.name, commits: contextLines, activity, aiLines };
}

/**
 * Assemble the human-readable context lines (numbers intact) for one repo: the
 * shared repo-context block plus issue refs, gh-only commit lines, and an
 * uncommitted-work line when the tree is dirty.
 */
function buildContextLines(
  entry: EnrichedRepoEntry,
  issueRefSet: Set<string>,
  ghCommitLines: string[],
  dirtyStat: string,
): string[] {
  const contextLines = formatRepoContext(entry);

  // Append issue refs line if any were found
  if (issueRefSet.size > 0) {
    contextLines.push(`[refs] ${[...issueRefSet].sort().join(' ')}`);
  }

  // Also include gh-only commit lines (not in local numstat) as plain lines
  if (ghCommitLines.length > 0) {
    contextLines.push(...ghCommitLines);
  }

  // Uncommitted changes count as activity: a dirty-only repo must still
  // pass the activeRepoData filter (contextLines.length > 0) downstream.
  if (dirtyStat !== '') {
    contextLines.push('[uncommitted] ' + dirtyStat);
  }
  return contextLines;
}

/**
 * Structured stats for the deterministic report skeleton: committed numbers
 * from numstat plus the parsed dirty stat. Pure.
 */
function computeActivity(
  name: string,
  localCommits: CommitDetail[],
  dirtyStat: string,
): RepoActivity {
  const dirty = parseDirtyStat(dirtyStat);
  const committedFiles = new Set<string>();
  let committedIns = 0;
  let committedDel = 0;
  for (const c of localCommits) {
    for (const f of c.files) committedFiles.add(f);
    committedIns += c.added;
    committedDel += c.deleted;
  }
  return {
    name,
    filesChanged: committedFiles.size + dirty.files,
    insertions: committedIns + dirty.insertions,
    deletions: committedDel + dirty.deletions,
    untracked: dirty.untracked,
    commitSubjects: localCommits.slice(0, 3).map((c) => c.subject),
  };
}

/**
 * Number-free lines for the AI executive summary — the on-device model parrots
 * (and miscomputes) any digits it is shown, so it gets only commit subjects,
 * PR/CI/event titles, a qualitative digest, and the WI-2.3 intent hints. Pure.
 */
export function buildAiLines(
  entry: EnrichedRepoEntry,
  activity: RepoActivity,
  branch?: string,
): string[] {
  const aiLines: string[] = [
    ...activity.commitSubjects.map((s) => 'commit: ' + s),
    ...entry.prs.map((p) => p.replace(/\s*\(\+\d+\/-\d+,\s*\d+\s*files?\)/g, '')),
    ...entry.ciLines,
    ...entry.events,
  ];
  const digest = qualitativeDigest(activity);
  if (digest) aiLines.push(digest);
  aiLines.push(...buildAiHints(entry, branch));
  return aiLines;
}

/** Remove every digit so a hint can never feed a parroted number to the model. */
function digitFree(s: string): string {
  return s
    .replace(/\d+/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

/**
 * WI-2.3: extra digit-free hints drawn from data already gathered — they give
 * the model intent signal (branch name, touched directories, a PR-title
 * excerpt, a failed CI workflow) without ever introducing a bare digit.
 * Returns only the hints that have content; empty repos add nothing.
 */
function buildAiHints(entry: EnrichedRepoEntry, branch?: string): string[] {
  const hints: string[] = [];

  // branch — encodes intent (feat/fix/chore/…); skip the uninformative defaults.
  if (branch && !/^(?:main|master|develop|trunk)$/i.test(branch)) {
    const b = digitFree(branch);
    if (b) hints.push('branch: ' + b);
  }

  // dirs — top-level directories touched, deduped, no counts.
  const topDirs = [
    ...new Set(
      entry.commits
        .flatMap((c) => c.folders)
        .map((f) => f.split('/')[0].trim())
        .filter(Boolean),
    ),
  ];
  if (topDirs.length > 0) hints.push('dirs: ' + digitFree(topDirs.join(', ')));

  // pr-context — a number-stripped excerpt of the first PR title (≤80 chars).
  if (entry.prs.length > 0) {
    const excerpt = digitFree(entry.prs[0]).slice(0, 80).trim();
    if (excerpt) hints.push('pr-context: ' + excerpt);
  }

  // ci-failure — workflow name(s) of any failed run ('[CI] FAIL: <name> on <branch>').
  for (const line of entry.ciLines) {
    const m = line.match(/FAIL:\s*(.+?)\s+on\s/);
    if (m) {
      const name = digitFree(m[1]);
      if (name) hints.push('ci-failure: ' + name);
    }
  }

  return hints;
}

/**
 * Fetch GitHub API commits + PR titles for a repo within the window. Mutates
 * `seenShas` (cross-repo dedup) and `issueRefSet` (issue refs from gh commit
 * subjects). Returns PR lines and gh-only commit lines. Throws RateLimitError
 * on a 429; other network errors are soft misses.
 */
async function gatherGitHubActivity(
  coords: { owner: string; repo: string } | null,
  token: string | null,
  windowStart: string,
  seenShas: Set<string>,
  issueRefSet: Set<string>,
): Promise<{ prLines: string[]; ghCommitLines: string[] }> {
  const prLines: string[] = [];
  const ghCommitLines: string[] = [];
  if (!coords || !token) return { prLines, ghCommitLines };

  const headers: Record<string, string> = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
  };

  // Helper: fetch with a hard 8-second timeout. Returns null on
  // network error or timeout; throws on 429 so the outer loop can
  // bail out early with a user-friendly rate-limit message.
  const fetchWithTimeout = async (url: string): Promise<Response | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429) {
        throw new RateLimitError();
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof RateLimitError) throw err;
      // AbortError or network error — treat as a soft miss for this repo.
      return null;
    }
  };

  // windowStart is passed as `since=` to both endpoints — GitHub excludes
  // everything at or before this timestamp, consistent with the local git lower
  // bound. No pre-window history is pulled in.
  const [commitsRes, prsRes] = await Promise.all([
    fetchWithTimeout(
      `https://api.github.com/repos/${coords.owner}/${coords.repo}/commits?since=${windowStart}&per_page=20`,
    ),
    fetchWithTimeout(
      `https://api.github.com/repos/${coords.owner}/${coords.repo}/pulls?state=all&sort=updated&per_page=10`,
    ),
  ]);
  ghCommitLines.push(...(await parseGhCommits(commitsRes, seenShas, issueRefSet)));
  prLines.push(...(await parseGhPrs(prsRes, coords, token, windowStart)));
  return { prLines, ghCommitLines };
}

/**
 * Parse a /commits response into gh-only commit lines. Mutates seenShas and
 * issueRefSet. Returns [] when the response is missing or not ok.
 */
async function parseGhCommits(
  res: Response | null,
  seenShas: Set<string>,
  issueRefSet: Set<string>,
): Promise<string[]> {
  if (!res?.ok) return [];
  const data = (await res.json().catch(() => [])) as Array<{
    sha: string;
    commit: { message: string };
    author?: { login?: string };
  }>;
  const lines: string[] = [];
  for (const c of data) {
    // Skip commits already covered by the local numstat scan —
    // --branches means nearly every pushed commit would duplicate.
    if (seenShas.has(c.sha)) continue;
    seenShas.add(c.sha);
    const subject = c.commit.message.split('\n')[0];
    const authorLogin = c.author?.login;
    const line = authorLogin ? `[${authorLogin}] ${subject}` : subject;
    // Also extract issue refs from gh commit subjects
    const matches = subject.matchAll(/#(\d+)/g);
    for (const m of matches) issueRefSet.add(`#${m[1]}`);
    lines.push(line);
  }
  return lines;
}

/**
 * Parse a /pulls response into PR lines: enriched details for the top 3, plain
 * titles for the rest. Returns [] when the response is missing or not ok.
 */
async function parseGhPrs(
  res: Response | null,
  coords: { owner: string; repo: string },
  token: string,
  windowStart: string,
): Promise<string[]> {
  if (!res?.ok) return [];
  const prs = (await res.json().catch(() => [])) as Array<{
    number: number;
    title: string;
    state: string;
    updated_at: string;
  }>;
  const recentPrs = prs.filter((pr) => pr.updated_at >= windowStart);
  // Fetch enriched PR details for top 3; fall back to plain title for the rest
  const prDetails = await Promise.all(
    recentPrs
      .slice(0, 3)
      .map((pr) => fetchPRDetails(coords.owner, coords.repo, pr.number, token).catch(() => null)),
  );
  return [
    ...prDetails.filter(Boolean).map((pr) => formatPRLine(pr!)),
    ...recentPrs.slice(3).map((pr) => `[PR #${pr.number}] ${pr.title}`),
  ];
}
