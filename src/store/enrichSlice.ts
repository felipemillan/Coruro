// Enrichment slice: fill runtime repos with GitHub badge data, local git
// ahead/behind + stats, and on-device AI summaries. All enrichment is
// fire-and-forget and (except for persisting gh/ai caches) runtime-only.
// Behaviour is identical to the inline implementation it replaces.

import { invoke } from '@tauri-apps/api/core';
import { type RepoGitHub, type AiCacheEntry, type AiResult, type AiContext } from '../types';
import { parseRemote, fetchRepoCard } from '../utils/github';
import { buildAiContext, inputHash } from '../utils/aiContext';
import type { BoardStore } from './boardStoreTypes';
import { type BoardSet, type BoardGet, errorMessage } from './boardStoreShared';

type EnrichSlice = Pick<
  BoardStore,
  'enrichGitHub' | 'enrichOne' | 'enrichGit' | 'enrichGitOne' | 'enrichAi' | 'enrichAiOne'
>;

export function createEnrichSlice(set: BoardSet, get: BoardGet): EnrichSlice {
  return {
    enrichGitHub: async () => {
      const targets = get().repos.filter(
        (r) => typeof r.remoteUrl === 'string' && parseRemote(r.remoteUrl) !== null,
      );
      if (targets.length === 0) return;

      // Transient token (never stored in JS state); unauthenticated if absent.
      const token = await invoke<string | null>('get_token').catch((e: unknown) => {
        // Rust returns Ok(None) (→ null) when no token is stored; a rejection here
        // is a genuine Keychain access failure, not "no token". Surface it.
        console.error('[keychain] get_token failed', errorMessage(e));
        return null;
      });

      // Bounded-concurrency pool so a large root can't fire hundreds of requests.
      const CONCURRENCY = 6;
      const ghByPath = new Map<string, RepoGitHub>();
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (cursor < targets.length) {
          const repo = targets[cursor];
          cursor += 1;
          const coords = parseRemote(repo.remoteUrl as string);
          if (coords === null) continue;
          try {
            ghByPath.set(repo.path, await fetchRepoCard(coords, token ?? undefined));
          } catch {
            // Per-repo failure: leave gh null for this repo.
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()),
      );

      // Merge by path against the LATEST repo list (a newer scan may have run).
      // A repo that failed this round keeps its previous gh (don't blank badges
      // on a transient error). Successful fetches update the persisted cache.
      const fetchedAt = new Date().toISOString();
      set((s) => {
        const ghCache = { ...s.ghCache };
        for (const [path, gh] of ghByPath) ghCache[path] = { gh, fetchedAt };
        return {
          repos: s.repos.map((r) => ({ ...r, gh: ghByPath.get(r.path) ?? r.gh ?? null })),
          ghCache,
        };
      });
      void get().save();
    },

    enrichOne: async (path) => {
      const repo = get().repos.find((r) => r.path === path);
      if (repo === undefined || typeof repo.remoteUrl !== 'string') return;
      const coords = parseRemote(repo.remoteUrl);
      if (coords === null) return;

      const token = await invoke<string | null>('get_token').catch((e: unknown) => {
        // Rust returns Ok(None) (→ null) when no token is stored; a rejection here
        // is a genuine Keychain access failure, not "no token". Surface it.
        console.error('[keychain] get_token failed', errorMessage(e));
        return null;
      });
      let gh: RepoGitHub;
      try {
        gh = await fetchRepoCard(coords, token ?? undefined);
      } catch {
        // Transient failure: keep the existing gh, don't blank the card.
        return;
      }

      const fetchedAt = new Date().toISOString();
      set((s) => ({
        repos: s.repos.map((r) => (r.path === path ? { ...r, gh } : r)),
        ghCache: { ...s.ghCache, [path]: { gh, fetchedAt } },
      }));
      void get().save();
    },

    enrichGit: async () => {
      const targets = get().repos;
      if (targets.length === 0) return;
      const CONCURRENCY = 8;
      const byPath = new Map<
        string,
        {
          ahead: number | null;
          behind: number | null;
          commitCount: number;
          lastCommitAt: string | null;
          branchCount: number;
        }
      >();
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (cursor < targets.length) {
          const repo = targets[cursor];
          cursor += 1;
          try {
            // git_ahead_behind returns [ahead, behind] or null (no upstream).
            const ab = await invoke<[number, number] | null>('git_ahead_behind', {
              path: repo.path,
            });
            // git_local_stats returns [commitCount, lastCommitAt, branchCount].
            const ls = await invoke<[number, string | null, number]>('git_local_stats', {
              path: repo.path,
            });
            byPath.set(repo.path, {
              ahead: ab === null ? null : ab[0],
              behind: ab === null ? null : ab[1],
              commitCount: ls[0],
              lastCommitAt: ls[1],
              branchCount: ls[2],
            });
          } catch {
            byPath.set(repo.path, {
              ahead: null,
              behind: null,
              commitCount: 0,
              lastCommitAt: null,
              branchCount: 0,
            });
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()),
      );
      // Merge against the latest repo list (a newer scan may have run).
      set((s) => ({
        repos: s.repos.map((r) => {
          const v = byPath.get(r.path);
          if (!v) return r;
          return {
            ...r,
            ahead: v.ahead,
            behind: v.behind,
            commitCount: v.commitCount,
            lastCommitAt: v.lastCommitAt,
            branchCount: v.branchCount,
          };
        }),
      }));
    },

    enrichGitOne: async (path) => {
      let ab: [number, number] | null = null;
      let ls: [number, string | null, number] = [0, null, 0];
      try {
        ab = await invoke<[number, number] | null>('git_ahead_behind', { path });
        ls = await invoke<[number, string | null, number]>('git_local_stats', { path });
      } catch {
        return;
      }
      set((s) => ({
        repos: s.repos.map((r) =>
          r.path === path
            ? {
                ...r,
                ahead: ab?.[0] ?? null,
                behind: ab?.[1] ?? null,
                commitCount: ls[0],
                lastCommitAt: ls[1],
                branchCount: ls[2],
              }
            : r,
        ),
      }));
    },

    enrichAi: async () => {
      const targets = get().repos;
      if (targets.length === 0) return;
      // Bounded-concurrency pool (mirrors enrichGitHub/enrichGit). The sidecar
      // drives the on-device model, so keep concurrency modest. Was a strict
      // serial loop — N repos meant N sequential sidecar round-trips.
      const CONCURRENCY = 3;
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (cursor < targets.length) {
          // Stop the whole pool if Apple Intelligence reported unavailable.
          if (get().aiUnavailableReason !== null) break;
          const repo = targets[cursor];
          cursor += 1;
          const ctx = await buildAiContext(repo);
          const hash = inputHash(ctx);
          const cached = get().aiCache[repo.path];
          if (cached && cached.inputHash === hash) continue; // fresh — skip

          const result = await runAiAnalyze(set, repo.path, ctx);
          const unavailable = applyAiResult(set, get, repo.path, result, hash);
          if (unavailable) break; // no point continuing this session
          // other errors: skip this repo, continue.
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()),
      );
    },

    enrichAiOne: async (path) => {
      const repo = get().repos.find((r) => r.path === path);
      if (!repo) return;
      const ctx = await buildAiContext(repo);
      const hash = inputHash(ctx);
      const result = await runAiAnalyze(set, path, ctx);
      applyAiResult(set, get, path, result, hash);
    },
  };
}

/**
 * Mark `path` as analyzing, invoke the AI sidecar, parse the result, then clear
 * the analyzing flag. An IPC/parse failure becomes 'invoke_failed' (kept
 * distinct from the sidecar's own 'generation' failure).
 */
async function runAiAnalyze(set: BoardSet, path: string, ctx: AiContext): Promise<AiResult> {
  set((s) => ({ analyzingPaths: new Set(s.analyzingPaths).add(path) }));
  let result: AiResult;
  try {
    result = JSON.parse(await invoke<string>('ai_analyze', { context: ctx })) as AiResult;
  } catch (err) {
    result = { ok: false, error: 'invoke_failed', reason: errorMessage(err) };
  }
  set((s) => {
    const next = new Set(s.analyzingPaths);
    next.delete(path);
    return { analyzingPaths: next };
  });
  return result;
}

/**
 * Apply an AI result for `path`: on success persist the cache entry + repo
 * summary/tags; on 'unavailable' record the reason. Returns true when the model
 * reported unavailable (so the caller can stop a batch).
 */
function applyAiResult(
  set: BoardSet,
  get: BoardGet,
  path: string,
  result: AiResult,
  hash: string,
): boolean {
  if (result.ok && result.summary) {
    const entry: AiCacheEntry = {
      summary: result.summary,
      tags: result.tags ?? [],
      model: result.model ?? 'unknown',
      analyzedAt: new Date().toISOString(),
      inputHash: hash,
    };
    set((s) => ({
      aiCache: { ...s.aiCache, [path]: entry },
      repos: s.repos.map((r) =>
        r.path === path ? { ...r, aiSummary: entry.summary, aiTags: entry.tags } : r,
      ),
    }));
    void get().save();
    return false;
  }
  if (result.error === 'unavailable') {
    set({ aiUnavailableReason: result.reason ?? 'unavailable' });
    return true;
  }
  return false;
}
