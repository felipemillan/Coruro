/**
 * GitHub utility helpers for MyGITdash.
 *
 * Two exports:
 *  - `parseRemote`      — extracts {owner, repo} from a git remote URL
 *  - `fetchOpenPrCount` — queries the GitHub REST API for open PR count
 *
 * No `any`. Token is optional; when absent the request is unauthenticated
 * (60 req/hr rate limit applies). Token is passed through from the macOS
 * Keychain via the Rust `get_token` command — never stored in JS state.
 */

/** Structured representation of a GitHub repository coordinate. */
export interface GitHubCoords {
  owner: string;
  repo: string;
}

/**
 * Parse a git remote URL into `{owner, repo}`.
 *
 * Handles:
 *  - SCP SSH:        `git@github.com:owner/repo.git`
 *  - HTTPS:          `https://github.com/owner/repo[.git][/]`
 *  - HTTPS+userinfo: `https://user:pat@github.com/owner/repo.git`
 *  - ssh:// scheme:  `ssh://git@github.com/owner/repo.git`
 *  - git:// scheme:  `git://github.com/owner/repo.git`
 *  - Trailing slash: any of the above ending with `/`
 *
 * Returns `null` for any URL that is not a recognisable github.com remote.
 */
export function parseRemote(url: string): GitHubCoords | null {
  // Single regex covering SCP-SSH, ssh://, git://, https:// (with optional userinfo),
  // optional .git suffix, and optional trailing slash.
  const m =
    /^(?:(?:https?|git|ssh):\/\/)?(?:[^@/]*@)?github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  if (m !== null) {
    return { owner: m[1], repo: m[2] };
  }

  return null;
}

/**
 * Fetch the number of open pull requests for a GitHub repository.
 *
 * Uses `GET /repos/{owner}/{repo}/pulls?state=open`.
 * Returns the array length on success, `0` on any non-200 response or
 * network / parse error.
 *
 * @param coords - `{owner, repo}` as returned by `parseRemote`.
 * @param token  - Optional GitHub PAT. When present, sent as `Authorization: Bearer <token>`.
 */
export async function fetchOpenPrCount(
  coords: GitHubCoords,
  token?: string,
): Promise<number> {
  const { owner, repo } = coords;
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
  };

  if (token !== undefined && token.length > 0) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, { headers });

    if (!response.ok) {
      return 0;
    }

    const data: unknown = await response.json();

    if (!Array.isArray(data)) {
      return 0;
    }

    return data.length;
  } catch {
    return 0;
  }
}
