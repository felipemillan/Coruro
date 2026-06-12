export interface CommitDetail {
  sha: string;
  subject: string;
  files: string[];
  folders: string[];
  added: number;
  deleted: number;
}

export interface EnrichedRepoEntry {
  repoName: string;
  commits: CommitDetail[];
  prs: string[];
  events: string[];
  ciLines: string[];
}

const MAX_COMMITS_PER_REPO = 15;
const MAX_FILES_PER_COMMIT = 2;
const FOLDER_AGGREGATE_THRESHOLD = 3;

export function formatRepoContext(entry: EnrichedRepoEntry): string[] {
  const lines: string[] = [];
  const folderCounts = new Map<string, number>();
  for (const c of entry.commits) {
    for (const f of c.folders) {
      folderCounts.set(f, (folderCounts.get(f) ?? 0) + 1);
    }
  }
  if (folderCounts.size > 0) {
    const topFolders = [...folderCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([f, n]) => f + '/ (' + n + ')')
      .join(', ');
    lines.push('[folders] ' + topFolders);
  }
  const cappedCommits = entry.commits.slice(0, MAX_COMMITS_PER_REPO);
  for (const c of cappedCommits) {
    const fileInfo = c.files.length > FOLDER_AGGREGATE_THRESHOLD
      ? c.folders.slice(0, 2).join(', ') + '/ (+' + c.added + '/-' + c.deleted + ')'
      : c.files.slice(0, MAX_FILES_PER_COMMIT).join(', ');
    lines.push(fileInfo ? c.subject + ' [' + fileInfo + ']' : c.subject);
  }
  lines.push(...entry.prs);
  lines.push(...entry.ciLines);
  lines.push(...entry.events);
  return lines;
}

/** Payload shape actually sent to the sidecar: repo name + formatted context lines. */
export interface RepoContextPayload {
  name: string;
  commits: string[];
}

/**
 * Cap the formatted context lines (the exact payload the sidecar receives).
 * Proportionally trims each repo's lines, keeping at least 3 per repo.
 */
export function capContextLines(repos: RepoContextPayload[], maxChars = 12000): RepoContextPayload[] {
  const total = repos.reduce((acc, r) => acc + r.commits.join('\n').length, 0);
  if (total <= maxChars) return repos;
  const ratio = maxChars / total;
  return repos.map((r) => ({
    ...r,
    commits: r.commits.slice(0, Math.max(3, Math.floor(r.commits.length * ratio))),
  }));
}

export function capDayNotesContext(entries: EnrichedRepoEntry[], maxChars = 5000): EnrichedRepoEntry[] {
  // Estimate against the formatted context lines (what actually reaches the sidecar),
  // not the raw EnrichedRepoEntry shape.
  const formatted = entries.map(e => formatRepoContext(e));
  const rough = formatted.reduce((acc, lines) => acc + lines.join('\n').length, 0);
  if (rough <= maxChars) return entries;
  const ratio = maxChars / rough;
  return entries.map((e) => ({
    ...e,
    commits: e.commits.slice(0, Math.max(3, Math.floor(e.commits.length * ratio))),
  }));
}
