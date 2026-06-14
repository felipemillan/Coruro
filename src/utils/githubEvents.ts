export interface ActivityEvent {
  type: string;
  repo: string;
  summary: string;
}

const RELEVANT = new Set([
  'PushEvent',
  'PullRequestEvent',
  'PullRequestReviewEvent',
  'CreateEvent',
  'ReleaseEvent',
  'IssueCommentEvent',
]);

function summarise(e: { type: string; payload: Record<string, unknown> }): string | null {
  const p = e.payload;
  if (e.type === 'PushEvent') {
    const n = ((p.commits as unknown[]) ?? []).length;
    return n ? 'pushed ' + n + ' commit(s)' : null;
  }
  if (e.type === 'PullRequestEvent')
    return (
      'PR ' + p.action + ': ' + ((p.pull_request as { title: string } | undefined)?.title ?? '')
    );
  if (e.type === 'PullRequestReviewEvent')
    return 'reviewed PR: ' + ((p.pull_request as { title: string } | undefined)?.title ?? '');
  if (e.type === 'IssueCommentEvent')
    return 'commented on issue #' + ((p.issue as { number: number } | undefined)?.number ?? '');
  if (e.type === 'CreateEvent') return ('created ' + p.ref_type + ' ' + (p.ref ?? '')).trim();
  if (e.type === 'ReleaseEvent')
    return 'released ' + ((p.release as { tag_name: string } | undefined)?.tag_name ?? '');
  return null;
}

export async function fetchUserEvents(
  login: string,
  token: string,
  windowStartIso: string,
): Promise<ActivityEvent[]> {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://api.github.com/users/' + login + '/events?per_page=100', {
      headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const events = (await res.json()) as Array<{
      type: string;
      repo: { name: string };
      created_at: string;
      payload: Record<string, unknown>;
    }>;
    const cutoff = new Date(windowStartIso).getTime();
    return events
      .filter((e) => RELEVANT.has(e.type) && new Date(e.created_at).getTime() >= cutoff)
      .flatMap((e) => {
        const s = summarise(e);
        return s ? [{ type: e.type, repo: e.repo.name, summary: s }] : [];
      });
  } catch {
    return [];
  }
}
