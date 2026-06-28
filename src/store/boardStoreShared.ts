// Shared internals for the Coruro board store slices.
//
// Holds the persisted-state filename, the serialise() snapshot helper, small
// error utilities, and the @-mention ref extractor. Slice creators
// (persistence/enrich/dayNotes/chatSessions/settings) import from here so they
// stay decoupled while composing into the single useBoardStore identity.

import type { StoreApi } from 'zustand';
import { type AppState, createEmptyAppState } from '../types';
import {
  validateSettings,
  validateBoard,
  validateRepoMetadata,
  validateGhCache,
  validateAiCache,
  validateDayNotes,
  validateChatSessions,
  validateActivityLog,
  validatePublisherHistory,
} from '../utils/appStateValidation';
import type { BoardStore } from './boardStoreTypes';

/** Filename written under the user's home directory. */
export const STATE_FILE = '.repo_dashboard_state.json';

/** Debounce window (ms) for persisting note edits. */
export const NOTES_DEBOUNCE_MS = 500;

/** Zustand setter bound to the composed BoardStore. */
export type BoardSet = StoreApi<BoardStore>['setState'];
/** Zustand getter bound to the composed BoardStore. */
export type BoardGet = StoreApi<BoardStore>['getState'];

/** Extract a human-readable message from an unknown thrown value. */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Sentinel thrown inside fetchWithTimeout when the GitHub API returns 429. */
export class RateLimitError extends Error {
  constructor() {
    super('GitHub API rate limit exceeded');
    this.name = 'RateLimitError';
  }
}

/**
 * Extract repo name refs from a day-note body (tokens prefixed with @).
 * Returns a deduplicated array of the name strings (without the @).
 */
export function extractRepoRefs(body: string): string[] {
  const matches = body.match(/@([a-zA-Z0-9_-]+)/g) || [];
  return [...new Set(matches.map((m: string) => m.slice(1)))];
}

/**
 * Runtime validator: coerce a parsed-from-disk value into a sound AppState.
 * A corrupt or hand-edited file (e.g. board.inbox not an array) must never
 * crash downstream .map/.indexOf — wrong-typed/missing fields fall back to
 * the empty defaults. Each slice is validated by a pure, independently-tested
 * validator (src/utils/appStateValidation.ts); a malformed slice degrades to
 * its default rather than crashing hydration.
 */
export function validateAppState(raw: unknown): AppState {
  const base = createEmptyAppState();
  if (typeof raw !== 'object' || raw === null) return base;
  const parsed = raw as Record<string, unknown>;

  return {
    settings: validateSettings(parsed.settings, base.settings),
    board: validateBoard(parsed.board, base.board),
    repoMetadata: validateRepoMetadata(parsed.repoMetadata, base.repoMetadata),
    ghCache: validateGhCache(parsed.ghCache, base.ghCache),
    aiCache: validateAiCache(parsed.aiCache, base.aiCache),
    dayNotes: validateDayNotes(parsed.dayNotes, base.dayNotes),
    chatSessions: validateChatSessions(parsed.chatSessions, base.chatSessions),
    activityLog: validateActivityLog(parsed.activityLog, base.activityLog),
    publisherHistory: validatePublisherHistory(parsed.publisherHistory, base.publisherHistory),
  };
}

/** Serialise only the persisted AppState slice (never runtime fields/token). */
export function serialise(state: AppState): string {
  const snapshot: AppState = {
    settings: state.settings,
    board: state.board,
    repoMetadata: state.repoMetadata,
    ghCache: state.ghCache,
    aiCache: state.aiCache,
    dayNotes: state.dayNotes,
    chatSessions: state.chatSessions,
    activityLog: state.activityLog,
    publisherHistory: state.publisherHistory,
  };
  return JSON.stringify(snapshot, null, 2);
}
