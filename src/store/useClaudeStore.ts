// Zustand store for Claude Command Center state.
//
// Enrichments are persisted to localStorage (keys below) to avoid re-running
// the on-device AI pass on every load.  Only blurbs whose context hash is
// unchanged are reused; stale/removed ids are pruned automatically.
// No secrets ever reach localStorage — claudeEnrich.ts guarantees secret-free
// context strings (packageHint + hostname only).

import { create, type StateCreator } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import {
  type ClaudeInventory,
  type AiDayNotesRepo,
  type ClaudeEnrichItem,
  type ClaudeEnrichResponse,
  type CurateFinding,
  type ClaudeCurateResponse,
} from '../types';
import { scanClaude as scanClaudeFs } from '../utils/claudeScanner';
import { buildClaudeHealthDigest } from '../utils/claudeHealthContext';
import { buildEnrichmentItems } from '../utils/claudeEnrich';
import { buildCurateFindings, buildCuratePayload } from '../utils/claudeCurate';
import { capItemsToContextBudget } from '../utils/aiContext';

// ── localStorage keys ────────────────────────────────────────────────────────
const LS_ENRICHMENTS = 'coruro.claude.enrichments';
const LS_ENRICHMENT_HASHES = 'coruro.claude.enrichments.hashes';

/**
 * Stable cyrb53 hash of a plain string — same algorithm as inputHash() in
 * aiContext.ts but accepts a raw string instead of an AiContext object.
 * Used to detect when an item's context has changed and its cached blurb
 * must be invalidated.
 */
function contextHash(str: string): string {
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

/** Load enrichments + hashes from localStorage, returning empty maps on any error. */
function loadEnrichmentsFromStorage(): {
  enrichments: Record<string, string>;
  enrichmentHashes: Record<string, string>;
} {
  try {
    const rawBlurbs = localStorage.getItem(LS_ENRICHMENTS);
    const rawHashes = localStorage.getItem(LS_ENRICHMENT_HASHES);
    const enrichments = rawBlurbs ? (JSON.parse(rawBlurbs) as Record<string, string>) : {};
    const enrichmentHashes = rawHashes ? (JSON.parse(rawHashes) as Record<string, string>) : {};
    return { enrichments, enrichmentHashes };
  } catch {
    return { enrichments: {}, enrichmentHashes: {} };
  }
}

/** Persist current enrichments + hashes to localStorage. */
function saveEnrichmentsToStorage(
  enrichments: Record<string, string>,
  enrichmentHashes: Record<string, string>,
): void {
  try {
    localStorage.setItem(LS_ENRICHMENTS, JSON.stringify(enrichments));
    localStorage.setItem(LS_ENRICHMENT_HASHES, JSON.stringify(enrichmentHashes));
  } catch {
    // localStorage quota exceeded or unavailable — silently degrade.
  }
}

/** Freshness window: skip rescan if inventory is younger than this. */
const SCAN_FRESHNESS_MS = 60_000;

interface ClaudeStore {
  inventory: ClaudeInventory | null;
  scanning: boolean;
  scanError: string | null;
  aiSummary: string | null;
  aiSummaryLoading: boolean;
  aiUnavailableReason: string | null;

  /**
   * Per-item AI blurbs keyed by ClaudeEnrichItem.id. Persisted to localStorage
   * so blurbs survive tab-away / reload without re-running the AI pass.
   * Entries are invalidated when the item's context string changes.
   */
  enrichments: Record<string, string>;
  /**
   * Parallel map: itemId → cyrb53 hash of the context string that produced the
   * blurb. Used during scanClaude to prune stale cache entries.
   */
  enrichmentHashes: Record<string, string>;
  enrichLoading: boolean;
  enrichUnavailableReason: string | null;
  /** Live progress of the background enrichment pass; null when idle. */
  enrichProgress: { done: number; total: number } | null;

  /** Deterministic curator findings (computed in TS). null until first run. */
  recommendations: CurateFinding[] | null;
  /** Additive AI narrative over the findings. null when none/ungenerated. */
  curateNarrative: string | null;
  curateLoading: boolean;
  curateUnavailableReason: string | null;

  /**
   * Scan the user's Claude Code setup and populate `inventory`.
   * Guards against redundant rescans: if inventory was produced within the
   * last 60 s, the call is a no-op unless `opts.force` is true.
   */
  scanClaude: (opts?: { force?: boolean }) => Promise<void>;

  /**
   * Generate a health summary for the current inventory via the on-device AI
   * sidecar. Sets `aiSummary` on success or `aiUnavailableReason` on failure.
   * Requires `inventory` to be populated first.
   */
  generateHealthSummary: () => Promise<void>;

  /**
   * Generate short descriptive blurbs for inventory items (MCP servers and
   * sessions) via the on-device AI sidecar. Runs automatically in the
   * background after each scan, in small chunks so progress can be reported.
   * Items already present in `enrichments` are skipped, so known ids are never
   * regenerated. Sets `enrichUnavailableReason` on failure.
   */
  generateEnrichments: () => Promise<void>;

  /**
   * Compute curator findings synchronously from the current inventory, then
   * (additively) request a qualitative AI narrative via the on-device sidecar.
   * Findings render immediately and independently of AI availability.
   * Requires `inventory` to be populated.
   */
  generateRecommendations: () => Promise<void>;
}

// ── Extracted async helpers (keep create() callback under line-count limit) ───

type StoreSet = Parameters<StateCreator<ClaudeStore>>[0];
type StoreGet = Parameters<StateCreator<ClaudeStore>>[1];

/** Invoke the sidecar for one chunk; returns parsed response or null on failure. */
async function invokeEnrichChunk(
  set: StoreSet,
  chunk: ClaudeEnrichItem[],
  done: number,
  total: number,
): Promise<ClaudeEnrichResponse | null> {
  try {
    const raw = await invoke<string>('ai_enrich', { items: chunk });
    return JSON.parse(raw) as ClaudeEnrichResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    set({
      enrichUnavailableReason: `AI enrichment issue: ${message}`,
      enrichProgress: { done, total },
    });
    return null;
  }
}

/** Merge a successful chunk's blurbs into store + localStorage. */
function applyEnrichChunk(
  set: StoreSet,
  get: StoreGet,
  chunk: ClaudeEnrichItem[],
  parsed: ClaudeEnrichResponse,
): boolean {
  if (parsed.ok && parsed.blurbs) {
    const mergedBlurbs: Record<string, string> = { ...get().enrichments };
    const mergedHashes: Record<string, string> = { ...get().enrichmentHashes };
    for (const blurb of parsed.blurbs) {
      mergedBlurbs[blurb.id] = blurb.text.trim();
      const src = chunk.find((it) => it.id === blurb.id);
      if (src) mergedHashes[blurb.id] = contextHash(src.context);
    }
    set({
      enrichments: mergedBlurbs,
      enrichmentHashes: mergedHashes,
      enrichUnavailableReason: null,
    });
    saveEnrichmentsToStorage(mergedBlurbs, mergedHashes);
    return false; // not terminal
  }
  const errCode = parsed.error ?? '';
  if (errCode.includes('sidecar_missing') || errCode.includes('unavailable')) {
    set({ enrichUnavailableReason: 'Apple Intelligence is unavailable on this device.' });
    return true; // terminal — stop the pass
  }
  if (errCode.length > 0) {
    set({ enrichUnavailableReason: `AI enrichment issue: ${errCode}` });
  }
  return false;
}

async function runGenerateEnrichments(set: StoreSet, get: StoreGet): Promise<void> {
  const { inventory, enrichments } = get();
  if (inventory === null) return;

  // Build secret-free items. Skip ids already cached (blurb + hash still valid).
  const items: ClaudeEnrichItem[] = buildEnrichmentItems(inventory);
  const newItems = items.filter((item) => !(item.id in enrichments));
  if (newItems.length === 0) return;

  if (get().enrichLoading) return; // already running — don't double-start

  const CHUNK = 4; // small chunks → smooth progress + bounded per-call latency
  set({
    enrichLoading: true,
    enrichUnavailableReason: null,
    enrichProgress: { done: 0, total: newItems.length },
  });
  try {
    for (let i = 0; i < newItems.length; i += CHUNK) {
      const chunk = capItemsToContextBudget(newItems.slice(i, i + CHUNK), (its) =>
        JSON.stringify({ mode: 'enrich', items: its }),
      );
      if (chunk.length === 0) continue;
      const doneAfter = Math.min(i + chunk.length, newItems.length);
      const parsed = await invokeEnrichChunk(set, chunk, doneAfter, newItems.length);
      if (parsed === null) continue; // transient failure already recorded
      const terminal = applyEnrichChunk(set, get, chunk, parsed);
      if (terminal) break;
      set({ enrichProgress: { done: doneAfter, total: newItems.length } });
    }
  } finally {
    set({ enrichLoading: false, enrichProgress: null });
  }
}

async function runGenerateRecommendations(set: StoreSet, get: StoreGet): Promise<void> {
  const { inventory } = get();
  if (inventory === null) return;

  const findings: CurateFinding[] = buildCurateFindings(inventory);
  set({ recommendations: findings });

  const { useBoardStore } = await import('./useBoardStore');
  useBoardStore.getState().logActivity({
    id: crypto.randomUUID(),
    ts: Date.now(),
    kind: 'curator_run',
    repoName: null,
  });

  set({ curateLoading: true, curateUnavailableReason: null });
  try {
    const payload = buildCuratePayload(findings);
    const cappedFindings = capItemsToContextBudget(payload.findings, (f) =>
      JSON.stringify({ mode: 'curate', findings: f, summary: payload.summary }),
    );
    const raw = await invoke<string>('ai_curate', {
      findings: cappedFindings,
      summary: payload.summary,
    });
    const parsed = JSON.parse(raw) as ClaudeCurateResponse;

    if (parsed.ok && parsed.body) {
      set({ curateNarrative: parsed.body.trim() });
    } else {
      const errCode = parsed.error ?? '';
      if (
        errCode.includes('noFindings') ||
        errCode.includes('unavailable') ||
        errCode.includes('sidecar_missing')
      ) {
        set({ curateUnavailableReason: null });
      } else if (errCode.length > 0) {
        set({ curateUnavailableReason: `AI narrative unavailable: ${errCode}` });
      } else {
        set({ curateUnavailableReason: 'AI narrative unavailable — unknown error.' });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    set({ curateUnavailableReason: `AI narrative unavailable: ${message}` });
  } finally {
    set({ curateLoading: false });
  }
}

// ── Store ────────────────────────────────────────────────────────────────────

// Load any previously persisted blurbs so the AI pass doesn't re-run on reload.
const { enrichments: _initEnrichments, enrichmentHashes: _initEnrichmentHashes } =
  loadEnrichmentsFromStorage();

export const useClaudeStore = create<ClaudeStore>((set, get) => ({
  inventory: null,
  scanning: false,
  scanError: null,
  aiSummary: null,
  aiSummaryLoading: false,
  aiUnavailableReason: null,
  enrichments: _initEnrichments,
  enrichmentHashes: _initEnrichmentHashes,
  enrichLoading: false,
  enrichUnavailableReason: null,
  enrichProgress: null,
  recommendations: null,
  curateNarrative: null,
  curateLoading: false,
  curateUnavailableReason: null,

  scanClaude: async (opts?: { force?: boolean }) => {
    const { inventory } = get();

    // Freshness guard — skip if inventory is recent and force is not set.
    if (!opts?.force && inventory !== null) {
      const scannedMs = new Date(inventory.scannedAt).getTime();
      if (Date.now() - scannedMs < SCAN_FRESHNESS_MS) {
        return;
      }
    }

    set({ scanning: true, scanError: null });
    try {
      const result = await scanClaudeFs();

      // Build the new inventory's item set so we can prune the enrichment cache.
      // Keep blurbs whose id is still present AND whose context hash is unchanged.
      // Drop blurbs for ids that no longer appear (pruned inventory).
      const newItems = buildEnrichmentItems(result);
      const newIdToContext = new Map(newItems.map((it) => [it.id, it.context]));
      const { enrichments: prevBlurbs, enrichmentHashes: prevHashes } = get();
      const keptBlurbs: Record<string, string> = {};
      const keptHashes: Record<string, string> = {};
      for (const [id, blurb] of Object.entries(prevBlurbs)) {
        const newCtx = newIdToContext.get(id);
        if (newCtx !== undefined && prevHashes[id] === contextHash(newCtx)) {
          keptBlurbs[id] = blurb;
          keptHashes[id] = prevHashes[id];
        }
      }
      // Persist the pruned cache immediately so stale entries don't survive reload.
      saveEnrichmentsToStorage(keptBlurbs, keptHashes);

      set({
        inventory: result,
        enrichments: keptBlurbs,
        enrichmentHashes: keptHashes,
        recommendations: null,
        curateNarrative: null,
        curateUnavailableReason: null,
        curateLoading: false,
      });
      // Kick off background enrichment for genuinely new/changed items.
      void get().generateEnrichments();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ scanError: message });
    } finally {
      set({ scanning: false });
    }
  },

  generateHealthSummary: async () => {
    const { inventory } = get();
    if (inventory === null) return;

    set({ aiSummaryLoading: true, aiUnavailableReason: null });
    try {
      const digest: AiDayNotesRepo[] = capItemsToContextBudget(
        buildClaudeHealthDigest(inventory),
        (repos) => JSON.stringify({ mode: 'day_notes', repos }),
      );
      const raw = await invoke<string>('ai_day_notes', { repos: digest });
      const parsed = JSON.parse(raw) as {
        ok: boolean;
        body?: string;
        model?: string;
        error?: string;
      };

      if (parsed.ok && parsed.body) {
        set({ aiSummary: parsed.body.trim() });
      } else {
        const errCode = parsed.error ?? '';
        let reason: string;
        if (errCode.includes('sidecar_missing') || errCode.includes('unavailable')) {
          reason = 'Apple Intelligence is unavailable on this device.';
        } else if (errCode.length > 0) {
          reason = `AI summary unavailable: ${errCode}`;
        } else {
          reason = 'AI summary unavailable — unknown error.';
        }
        set({ aiUnavailableReason: reason });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ aiUnavailableReason: `AI summary unavailable: ${message}` });
    } finally {
      set({ aiSummaryLoading: false });
    }
  },

  generateEnrichments: () => runGenerateEnrichments(set, get),

  generateRecommendations: () => runGenerateRecommendations(set, get),
}));
