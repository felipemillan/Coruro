// Activity-log slice: append / query / clear in-app activity events.
// Metadata-only and secret-free — no prompt bodies, transcripts, or token
// values are ever stored here. Mirrors the chatSessionsSlice contract.
//
// P0 invariants this file must uphold:
//   #1 (zero-network AI): logActivity is synchronous; it never triggers a
//      sidecar call or any network request.
//   #2 (secret-free): only `kind` (enum), `repoName` (slug), and an optional
//      constrained `label` are persisted. No paths, tokens, or prompt bodies.

import type { ActivityEvent, ActivityLogState } from '../types';
import { type BoardSet, type BoardGet } from './boardStoreShared';

/** Hard cap on persisted activity events; oldest events are evicted first. */
export const MAX_ACTIVITY_EVENTS = 500;

export interface ActivityLogSlice {
  /** Append one event, enforce the 500-event cap (drop oldest), then save. */
  logActivity: (event: ActivityEvent) => void;
  /**
   * Return all events whose `ts` falls within [windowStartIso, windowEndIso]
   * (inclusive on both ends). The ISO strings match the format already used by
   * dayNotesSlice (line 129): new Date(ts).toISOString() round-trips cleanly.
   */
  eventsInWindow: (windowStartIso: string, windowEndIso: string) => ActivityEvent[];
  /** Empty the event list and save. */
  clearActivityLog: () => void;
}

export function createActivityLogSlice(set: BoardSet, get: BoardGet): ActivityLogSlice {
  return {
    logActivity: (event) => {
      set((s) => {
        const next = [...s.activityLog.events, event];
        const capped =
          next.length > MAX_ACTIVITY_EVENTS ? next.splice(next.length - MAX_ACTIVITY_EVENTS) : next;
        const activityLog: ActivityLogState = { ...s.activityLog, events: capped };
        return { activityLog };
      });
      void get().save();
    },

    eventsInWindow: (windowStartIso, windowEndIso) => {
      const start = Date.parse(windowStartIso);
      const end = Date.parse(windowEndIso);
      return get().activityLog.events.filter((e) => e.ts >= start && e.ts <= end);
    },

    clearActivityLog: () => {
      set((s) => ({ activityLog: { ...s.activityLog, events: [] } }));
      void get().save();
    },
  };
}
