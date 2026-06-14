export interface PRDetail {
  number: number;
  title: string;
  body: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export async function fetchPRDetails(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<PRDetail | null> {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      'https://api.github.com/repos/' + owner + '/' + repo + '/pulls/' + prNumber,
      {
        headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' },
        signal: controller.signal,
      },
    );
    if (!res.ok) return null;
    const pr = (await res.json()) as {
      number: number;
      title: string;
      body: string | null;
      additions: number;
      deletions: number;
      changed_files: number;
    };
    return {
      number: pr.number,
      title: pr.title,
      body: (pr.body ?? '').slice(0, 300),
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
    };
  } catch {
    return null;
  }
}

export function formatPRLine(pr: PRDetail): string {
  const stats = '+' + pr.additions + '/-' + pr.deletions + ', ' + pr.changedFiles + ' files';
  const snippet = pr.body.trim().slice(0, 120);
  return snippet
    ? '[PR #' + pr.number + '] ' + pr.title + ' (' + stats + ') — ' + snippet
    : '[PR #' + pr.number + '] ' + pr.title + ' (' + stats + ')';
}
