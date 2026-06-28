// Publisher-history slice: append / delete / clear persisted Publisher
// generations. Each entry stores the generated copy plus the full PublisherBrief
// (roles, seniority, audience, intent, guidance, answers) — user-authored text +
// a `repoName` slug, secret-free and path-free. The validator length-caps the
// free-text brief fields and rejects a path-shaped repoName on load. Mirrors the
// activityLogSlice contract.
//
// P0 invariants this file must uphold:
//   #1 (zero-network AI): every action is synchronous; none triggers a sidecar
//      call or any network request.
//   #2 (no raw paths): entries carry a `repoName` slug only — the validator
//      rejects path-shaped values on load.

import type { PublisherHistoryEntry, PublisherHistoryState } from '../types';
import { MAX_PUBLISHER_HISTORY } from '../types';
import { type BoardSet, type BoardGet } from './boardStoreShared';

export interface PublisherHistorySlice {
  /** Append one entry, enforce the 200-entry cap (drop oldest), then save. */
  addPublisherHistoryEntry: (entry: PublisherHistoryEntry) => void;
  /** Hard-delete one entry by id and save. */
  deletePublisherHistoryEntry: (id: string) => void;
  /** Empty the entry list and save. */
  clearPublisherHistory: () => void;
}

export function createPublisherHistorySlice(set: BoardSet, get: BoardGet): PublisherHistorySlice {
  return {
    addPublisherHistoryEntry: (entry) => {
      set((s) => {
        const next = [...s.publisherHistory.entries, entry];
        const capped =
          next.length > MAX_PUBLISHER_HISTORY
            ? next.splice(next.length - MAX_PUBLISHER_HISTORY)
            : next;
        const publisherHistory: PublisherHistoryState = {
          ...s.publisherHistory,
          entries: capped,
        };
        return { publisherHistory };
      });
      void get().save();
    },

    deletePublisherHistoryEntry: (id) => {
      set((s) => ({
        publisherHistory: {
          ...s.publisherHistory,
          entries: s.publisherHistory.entries.filter((e) => e.id !== id),
        },
      }));
      void get().save();
    },

    clearPublisherHistory: () => {
      set((s) => ({ publisherHistory: { ...s.publisherHistory, entries: [] } }));
      void get().save();
    },
  };
}
