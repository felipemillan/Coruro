// Zustand store for Claude Command Center state.
//
// Runtime-only ephemeral state: inventory scan results, AI health summary.
// Never persisted — all state is re-derived on demand.

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { type ClaudeInventory, type AiDayNotesRepo } from '../types';
import { scanClaude as scanClaudeFs } from '../utils/claudeScanner';
import { buildClaudeHealthDigest } from '../utils/claudeHealthContext';

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
}

export const useClaudeStore = create<ClaudeStore>((set, get) => ({
  inventory: null,
  scanning: false,
  scanError: null,
  aiSummary: null,
  aiSummaryLoading: false,
  aiUnavailableReason: null,

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
      set({ inventory: result });
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
}));
