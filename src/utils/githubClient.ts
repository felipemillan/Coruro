// githubClient.ts — authenticated GitHub REST client with an in-memory ETag cache.
//
// One DRY core (`ghJson`) used by every GitHub fetcher. Conditional requests
// (If-None-Match) make unchanged resources return 304, which DOES NOT count
// against the rate limit — so manual rescans within a session are nearly free.
// The cache is module-level and session-lived (cleared on app restart, by design).

const API_BASE = 'https://api.github.com';

interface CacheEntry {
  etag: string;
  data: unknown;
}

const etagCache = new Map<string, CacheEntry>();

export interface GhResult<T> {
  data: T | null;
  status: number;
}

/**
 * Authenticated GET against the GitHub REST API with ETag conditional caching.
 * Never throws. `path` is appended to https://api.github.com.
 *
 *  - 200 → cache {etag,data} when an ETag header is present; return data.
 *  - 304 → return the cached data (status 304).
 *  - 404 / other non-ok → { data: null, status }.
 *  - network / parse error → { data: null, status: 0 }.
 */
export async function ghJson<T>(path: string, token?: string): Promise<GhResult<T>> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token !== undefined && token.length > 0) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const cached = etagCache.get(url);
  if (cached !== undefined) {
    headers['If-None-Match'] = cached.etag;
  }

  try {
    const response = await fetch(url, { headers });
    const remaining = response.headers.get('x-ratelimit-remaining');
    console.debug(
      '[ghJson]',
      response.status,
      path,
      remaining !== null ? `rl=${remaining}` : '',
      token ? 'auth' : 'anon',
    );

    if (response.status === 304 && cached !== undefined) {
      return { data: cached.data as T, status: 304 };
    }
    if (!response.ok) {
      return { data: null, status: response.status };
    }

    const data = (await response.json()) as T;
    const etag = response.headers.get('ETag');
    if (etag !== null) {
      etagCache.set(url, { etag, data });
    }
    return { data, status: response.status };
  } catch (e) {
    console.debug('[ghJson] network error', path, e);
    return { data: null, status: 0 };
  }
}
