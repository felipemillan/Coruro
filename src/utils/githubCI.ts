export interface CIRun {
  name: string;
  status: string;
  conclusion: string | null;
  headBranch: string;
}

export async function fetchCIOutcomes(owner: string, repo: string, token: string, windowStartIso: string): Promise<CIRun[]> {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    const params = new URLSearchParams({ 'created': '>=' + windowStartIso, per_page: '10' });
    const url = 'https://api.github.com/repos/' + owner + '/' + repo + '/actions/runs?' + params.toString();
    const res = await fetch(url, {
      headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json() as { workflow_runs: Array<{ name: string; status: string; conclusion: string | null; head_branch: string }> };
    return (data.workflow_runs ?? []).map(r => ({ name: r.name, status: r.status, conclusion: r.conclusion, headBranch: r.head_branch }));
  } catch { return []; }
}

export function formatCILine(run: CIRun): string {
  const icon = run.conclusion === 'success' ? 'pass' : run.conclusion === 'failure' ? 'FAIL' : 'running';
  return '[CI] ' + icon + ': ' + run.name + ' on ' + run.headBranch;
}
