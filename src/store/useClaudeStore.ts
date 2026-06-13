// Zustand store for Claude Command Center state.
//
// Runtime-only ephemeral state: inventory scan results, AI health summary.
// Never persisted — all state is re-derived on demand.

import { create } from 'zustand';
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
   * Per-item AI blurbs keyed by ClaudeEnrichItem.id. Acts as an in-memory
   * cache: once an id has a blurb it is never regenerated for the session.
   */
  enrichments: Record<string, string>;
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

export const useClaudeStore = create<ClaudeStore>((set, get) => ({
  inventory: null,
  scanning: false,
  scanError: null,
  aiSummary: null,
  aiSummaryLoading: false,
  aiUnavailableReason: null,
  enrichments: {},
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
      // Fresh inventory invalidates the per-item blurb cache and stale curator state.
      set({
        inventory: result,
        enrichments: {},
        recommendations: null,
        curateNarrative: null,
        curateUnavailableReason: null,
        curateLoading: false,
      });
      // Kick off background enrichment (best-effort; never blocks the scan).
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
    if (inventory === null) {
      return;
    }

    set({ aiSummaryLoading: true, aiUnavailableReason: null });
    try {
      const digest: AiDayNotesRepo[] = buildClaudeHealthDigest(inventory);
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
        if (
          errCode.includes('sidecar_missing') ||
          errCode.includes('unavailable')
        ) {
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
      set({
        aiUnavailableReason: `AI summary unavailable: ${message}`,
      });
    } finally {
      set({ aiSummaryLoading: false });
    }
  },

  generateEnrichments: async () => {
    const { inventory, enrichments } = get();
    if (inventory === null) {
      return;
    }

    // Build secret-free items, then drop any id we already have a blurb for —
    // the in-memory cache is authoritative; known ids are never regenerated.
    const items: ClaudeEnrichItem[] = buildEnrichmentItems(inventory);
    const newItems = items.filter((item) => !(item.id in enrichments));
    if (newItems.length === 0) {
      return;
    }

    // Already running? don't double-start.
    if (get().enrichLoading) return;

    const CHUNK = 4; // small chunks → smooth progress + bounded per-call latency
    set({
      enrichLoading: true,
      enrichUnavailableReason: null,
      enrichProgress: { done: 0, total: newItems.length },
    });
    try {
      for (let i = 0; i < newItems.length; i += CHUNK) {
        const chunk = newItems.slice(i, i + CHUNK);
        let parsed: ClaudeEnrichResponse;
        try {
          const raw = await invoke<string>('ai_enrich', { items: chunk });
          parsed = JSON.parse(raw) as ClaudeEnrichResponse;
        } catch (err) {
          // Transient invoke/parse failure on one chunk — skip it, keep going.
          const message = err instanceof Error ? err.message : String(err);
          set({ enrichUnavailableReason: `AI enrichment issue: ${message}` });
          set({ enrichProgress: { done: Math.min(i + chunk.length, newItems.length), total: newItems.length } });
          continue;
        }

        if (parsed.ok && parsed.blurbs) {
          const merged: Record<string, string> = { ...get().enrichments };
          for (const blurb of parsed.blurbs) {
            merged[blurb.id] = blurb.text.trim();
          }
          set({ enrichments: merged, enrichUnavailableReason: null });
        } else {
          const errCode = parsed.error ?? '';
          // Device-level unavailability is terminal — stop the whole pass.
          if (errCode.includes('sidecar_missing') || errCode.includes('unavailable')) {
            set({ enrichUnavailableReason: 'Apple Intelligence is unavailable on this device.' });
            break;
          }
          // Otherwise note it and continue with the next chunk.
          if (errCode.length > 0) {
            set({ enrichUnavailableReason: `AI enrichment issue: ${errCode}` });
          }
        }

        set({ enrichProgress: { done: Math.min(i + chunk.length, newItems.length), total: newItems.length } });
      }
    } finally {
      set({ enrichLoading: false, enrichProgress: null });
    }
  },

  generateRecommendations: async () => {
    const { inventory } = get();
    if (inventory === null) {
      return;
    }

    // DETERMINISTIC: compute + commit findings first. These render instantly
    // and never depend on AI availability.
    const findings: CurateFinding[] = buildCurateFindings(inventory);
    set({ recommendations: findings });

    // ADDITIVE: qualitative narrative only. Mirrors generateHealthSummary.
    set({ curateLoading: true, curateUnavailableReason: null });
    try {
      const payload = buildCuratePayload(findings);
      const raw = await invoke<string>('ai_curate', {
        findings: payload.findings,
        summary: payload.summary,
      });
      const parsed = JSON.parse(raw) as ClaudeCurateResponse;

      if (parsed.ok && parsed.body) {
        set({ curateNarrative: parsed.body.trim() });
      } else {
        const errCode = parsed.error ?? '';
        // A tidy setup (noFindings) or an unavailable device are benign — the
        // deterministic findings (or empty state) already convey everything.
        if (errCode.includes('noFindings') || errCode.includes('unavailable') || errCode.includes('sidecar_missing')) {
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
  },
}));
