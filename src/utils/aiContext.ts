// aiContext.ts — assemble a bounded AI context payload for one repo.
// Split into a PURE core (assembleContext, inputHash) that is unit-tested, and
// an async gatherer (buildAiContext) that does the IO (git/fs) and delegates to
// the pure core. The 4096-token model window forces hard caps.

import { invoke } from '@tauri-apps/api/core';
import { readDir, readTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type { AiContext, Repo } from '../types';

/** Conservative payload ceiling (~3.5 chars/token → well under 4096 tokens). */
export const MAX_PAYLOAD_CHARS = 6000;

/**
 * Shared model context-window budget (Coruro invariant #5). Mirrors the Swift
 * `maxContextTokens` backstop in the sidecar; the TS side trims every AI payload
 * to this budget so normal use never trips the sidecar's contextOverflow path.
 */
export const MAX_CONTEXT_TOKENS = 4096;

/**
 * Conservative chars→tokens estimate, matching the sidecar's estimator: ASCII
 * counts ~0.25 tokens/char (~4 chars/token), every non-ASCII code unit a full
 * token (CJK/emoji are far more token-dense). Over-counting caps payloads
 * earlier rather than risking an overflow at the model boundary.
 */
export function estimatePayloadTokens(text: string): number {
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    tokens += text.charCodeAt(i) < 128 ? 0.25 : 1;
  }
  return Math.ceil(tokens);
}

/** True when a serialized payload would exceed the model context window. */
export function exceedsContextBudget(text: string, maxTokens = MAX_CONTEXT_TOKENS): boolean {
  return estimatePayloadTokens(text) > maxTokens;
}

/**
 * Drop trailing items until the serialized list fits the token budget. Used by
 * every multi-item AI payload (day notes, enrichment, curation) so none can
 * exceed the sidecar's 4096-token window. `serialize` should mirror the actual
 * request shape sent to the sidecar so the estimate matches what the model sees.
 */
export function capItemsToContextBudget<T>(
  items: T[],
  serialize: (items: T[]) => string,
  maxTokens = MAX_CONTEXT_TOKENS,
): T[] {
  let capped = items;
  while (capped.length > 0 && exceedsContextBudget(serialize(capped), maxTokens)) {
    capped = capped.slice(0, capped.length - 1);
  }
  return capped;
}

interface RawParts {
  repoName: string;
  description: string | null;
  languages: string[];
  recentCommits: string[];
  topEntries: string[];
  readme: string | null;
}

/** PURE: cap and normalise raw parts into a bounded AiContext. */
export function assembleContext(parts: RawParts): AiContext {
  const languages = parts.languages.slice(0, 5);
  const recentCommits = parts.recentCommits.slice(0, 15).map((c) => c.slice(0, 100));
  const topEntries = parts.topEntries.slice(0, 25);
  let readme = parts.readme ? parts.readme.slice(0, 1200) : null;

  let ctx: AiContext = {
    repoName: parts.repoName,
    description: parts.description,
    languages,
    recentCommits,
    topEntries,
    readme,
  };

  // Final guard: if still over budget, drop the readme, then trim commits.
  if (JSON.stringify(ctx).length > MAX_PAYLOAD_CHARS) {
    readme = null;
    ctx = { ...ctx, readme };
  }
  while (JSON.stringify(ctx).length > MAX_PAYLOAD_CHARS && ctx.recentCommits.length > 0) {
    ctx = { ...ctx, recentCommits: ctx.recentCommits.slice(0, ctx.recentCommits.length - 1) };
  }
  return ctx;
}

/** PURE: stable 53-bit hash (cyrb53) of the assembled context. */
export function inputHash(ctx: AiContext): string {
  const str = JSON.stringify(ctx);
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** Async: gather raw repo signals (git + fs), then assemble. */
export async function buildAiContext(repo: Repo): Promise<AiContext> {
  let recentCommits: string[] = [];
  try {
    recentCommits = await invoke<string[]>('git_recent_commits', { path: repo.path, count: 20 });
  } catch {
    recentCommits = [];
  }

  let topEntries: string[] = [];
  try {
    const entries = await readDir(repo.path);
    topEntries = entries.map((e) => e.name).filter((n) => n !== '.git');
  } catch {
    topEntries = [];
  }

  let readme: string | null = null;
  try {
    const readmePath = await join(repo.path, 'README.md');
    if (await exists(readmePath)) readme = await readTextFile(readmePath);
  } catch {
    readme = null;
  }

  const languages = repo.gh?.language ? [repo.gh.language] : [];

  return assembleContext({
    repoName: repo.name,
    description: repo.gh?.description ?? null,
    languages,
    recentCommits,
    topEntries,
    readme,
  });
}
