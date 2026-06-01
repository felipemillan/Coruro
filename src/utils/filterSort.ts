import type { Repo } from '../types';
import type { FilterKey, SortMode } from '../view';
import { STALE_DAYS } from '../view';

/**
 * Returns true when the repo matches the search query.
 * Empty / whitespace-only query always returns true.
 * Otherwise does a case-insensitive substring match against
 * repo.name, repo.gh?.language ?? '', and repo.branch.
 */
export function matchesSearch(repo: Repo, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const haystack = [repo.name, repo.gh?.language ?? '', repo.branch]
    .join('\0')
    .toLowerCase();
  return haystack.includes(q);
}

/**
 * Returns true when the repo passes all active filters (AND semantics).
 * Empty filter set always returns true.
 */
export function passesFilters(repo: Repo, filters: ReadonlySet<FilterKey>): boolean {
  if (filters.size === 0) return true;

  for (const key of filters) {
    switch (key) {
      case 'dirty':
        if (repo.dirty !== true) return false;
        break;
      case 'prs':
        if ((repo.gh?.prCount ?? 0) <= 0) return false;
        break;
      case 'issues':
        if ((repo.gh?.openIssues ?? 0) <= 0) return false;
        break;
      case 'stale': {
        const pushedAt = repo.gh?.pushedAt;
        if (!pushedAt) return false;
        const ms = Date.parse(pushedAt);
        if (isNaN(ms)) return false;
        const ageDays = (Date.now() - ms) / 86_400_000;
        if (ageDays <= STALE_DAYS) return false;
        break;
      }
      case 'private':
        if (repo.gh?.isPrivate !== true) return false;
        break;
      case 'fork':
        if (repo.gh?.fork !== true) return false;
        break;
      case 'ciFailing':
        if (repo.gh?.ciStatus !== 'failure') return false;
        break;
    }
  }
  return true;
}

/** Parses pushedAt to a sortable number; missing/empty/invalid → -Infinity. */
function pushedAtMs(repo: Repo): number {
  const p = repo.gh?.pushedAt;
  if (!p) return -Infinity;
  const ms = Date.parse(p);
  return isNaN(ms) ? -Infinity : ms;
}

/**
 * Returns a NEW sorted array — never mutates the input.
 * Sort modes:
 *   manual  – shallow copy in original order (stable).
 *   pushed  – gh.pushedAt DESC (newest first); missing/empty → bottom.
 *   name    – a.name.localeCompare(b.name) ASC.
 *   stars   – gh?.stars ?? 0 DESC; ties → name ASC.
 */
export function sortRepos(repos: Repo[], mode: SortMode): Repo[] {
  const copy = [...repos];
  switch (mode) {
    case 'manual':
      return copy; // already a new array, order unchanged

    case 'pushed':
      return copy.sort((a, b) => pushedAtMs(b) - pushedAtMs(a));

    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name));

    case 'stars':
      return copy.sort((a, b) => {
        const diff = (b.gh?.stars ?? 0) - (a.gh?.stars ?? 0);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name);
      });
  }
}

/**
 * Applies search → filter → sort in sequence.
 * Returns a new array; inputs are never mutated.
 */
export function applyView(
  repos: Repo[],
  opts: { search: string; filters: ReadonlySet<FilterKey>; sort: SortMode },
): Repo[] {
  const filtered = repos.filter(
    (r) => matchesSearch(r, opts.search) && passesFilters(r, opts.filters),
  );
  return sortRepos(filtered, opts.sort);
}
