// Day-notes slice: note CRUD, the auto-notes timer, and generateDayNotes (the
// AI day-note pipeline). The heavy pure/IO logic lives in dayNotesWindow.ts
// (window math) and githubDayNotes.ts (activity gathering); this slice wires
// them to store state. Behaviour is identical to the inline implementation.

import { invoke } from '@tauri-apps/api/core';
import { type DayNote } from '../types';
import { capItemsToContextBudget } from '../utils/aiContext';
import { capContextLines } from '../utils/dayNotesContext';
import { composeSessionReport } from '../utils/sessionReport';
import { fetchUserLogin } from '../utils/githubUser';
import { fetchUserEvents } from '../utils/githubEvents';
import type { BoardStore } from './boardStoreTypes';
import {
  type BoardSet,
  type BoardGet,
  errorMessage,
  extractRepoRefs,
  RateLimitError,
} from './boardStoreShared';
import { runtimeEffects } from './runtimeEffects';
import { computeWindow, shouldSkipAutoRun } from './dayNotesWindow';
import { gatherRepoDayNotesData } from './githubDayNotes';

type DayNotesSlice = Pick<
  BoardStore,
  | 'addDayNote'
  | 'clearDayNotes'
  | 'deleteDayNote'
  | 'addUserNote'
  | 'updateDayNote'
  | 'setAutoNotesEnabled'
  | 'setAutoNotesIntervalMin'
  | 'generateDayNotes'
  | 'setupAutoNotesTimer'
  | 'clearNotesError'
>;

export function createDayNotesSlice(set: BoardSet, get: BoardGet): DayNotesSlice {
  return {
    addDayNote: (note) => {
      set((s) => {
        const notes = [...s.dayNotes.notes, note];
        if (notes.length > 90) notes.splice(0, notes.length - 90);
        return { dayNotes: { ...s.dayNotes, notes } };
      });
      void get().save();
    },

    clearDayNotes: () => {
      set((s) => ({ dayNotes: { ...s.dayNotes, notes: [] } }));
      void get().save();
    },

    deleteDayNote: (id) => {
      set((s) => ({
        dayNotes: { ...s.dayNotes, notes: s.dayNotes.notes.filter((n) => n.id !== id) },
      }));
      void get().save();
    },

    addUserNote: (body) => {
      // Human-written note: no AI window, so both window bounds collapse to now.
      const now = new Date().toISOString();
      const note: DayNote = {
        id: crypto.randomUUID(),
        generatedAt: now,
        windowStart: now,
        windowEnd: now,
        body,
        repoRefs: extractRepoRefs(body),
        model: 'user',
        trigger: 'user',
      };
      get().addDayNote(note);
    },

    updateDayNote: (id, body) => {
      set((s) => ({
        dayNotes: {
          ...s.dayNotes,
          notes: s.dayNotes.notes.map((n) =>
            n.id === id
              ? { ...n, body, editedAt: new Date().toISOString(), repoRefs: extractRepoRefs(body) }
              : n,
          ),
        },
      }));
      void get().save();
    },

    setAutoNotesEnabled: (enabled) => {
      set((s) => ({ settings: { ...s.settings, autoNotesEnabled: enabled } }));
      void get().save();
      // Skip the immediate fire: the user is changing a setting, not starting a
      // session. Only the App.tsx startup path should fire immediately.
      get().setupAutoNotesTimer({ skipImmediateFire: true });
    },

    setAutoNotesIntervalMin: (min) => {
      set((s) => ({ settings: { ...s.settings, autoNotesIntervalMin: min } }));
      void get().save();
      // Skip the immediate fire: NotesTab calls this on every valid keystroke
      // while the user types an interval (e.g. "1", "12", "120"). Firing
      // generateDayNotes on every keystroke would create unwanted duplicate notes.
      get().setupAutoNotesTimer({ skipImmediateFire: true });
    },

    generateDayNotes: async (trigger) => {
      if (get().generatingNotes) return;
      set({ generatingNotes: true, notesError: null });
      try {
        const now = Date.now();
        const notes = get().dayNotes.notes;

        // For auto triggers: skip silently when the last AI note is still within
        // the configured interval. Manual triggers always proceed.
        if (
          trigger === 'auto' &&
          shouldSkipAutoRun(notes, now, get().settings.autoNotesIntervalMin)
        ) {
          return;
        }

        const { windowStart, windowEnd } = computeWindow(notes, now);

        const token = await resolveToken();
        const allEvents = await gatherUserEvents(token, windowStart);

        const repoData = await gatherRepoDayNotesData({
          repos: get().repos,
          token,
          allEvents,
          windowStart,
        });

        // Only include repos that have activity in the window
        const activeRepoData = repoData.filter((r) => r.commits.length > 0);

        if (activeRepoData.length === 0) {
          // Manual click deserves feedback; a recurring auto run with a quiet
          // window should not paint an error banner.
          if (trigger === 'manual') {
            set({ notesError: 'No activity found since the last note.' });
          }
          return;
        }

        // Cap total context before sending to sidecar. The AI sees only the
        // number-free digest lines; the numeric stats live in the composed report.
        const cappedRepoData = capItemsToContextBudget(
          capContextLines(
            activeRepoData.map(({ name, aiLines }) => ({ name, commits: aiLines })),
            8000,
          ),
          (repos) => JSON.stringify({ mode: 'day_notes', repos }),
        );

        // The report skeleton (tiers, metrics, per-repo stats) is deterministic;
        // Apple Intelligence contributes only the executive-summary narrative.
        // An AI failure therefore degrades to a stats-only note, never a no-note.
        const { execSummary, model } = await fetchExecSummary(cappedRepoData);

        const body = composeSessionReport(
          activeRepoData.map((r) => r.activity),
          execSummary,
          new Date(now),
        );

        const note: DayNote = {
          id: crypto.randomUUID(),
          generatedAt: new Date().toISOString(),
          windowStart,
          windowEnd,
          body,
          repoRefs: extractRepoRefs(body),
          model,
          trigger,
        };
        get().addDayNote(note);
        set({ notesError: null });
      } catch (e) {
        if (e instanceof RateLimitError) {
          set({ notesError: 'GitHub API rate limit reached. Wait a moment and try again.' });
        } else {
          set({ notesError: `Error: ${e instanceof Error ? e.message : String(e)}` });
        }
      } finally {
        set({ generatingNotes: false });
      }
    },

    setupAutoNotesTimer: ({ skipImmediateFire = false } = {}) => {
      const existing = runtimeEffects.getAutoNotesTimer();
      if (existing) {
        clearInterval(existing);
        runtimeEffects.setAutoNotesTimer(null);
      }
      const { autoNotesEnabled, autoNotesIntervalMin } = get().settings;
      if (autoNotesEnabled && autoNotesIntervalMin > 0) {
        // Only fire immediately from the startup path (App.tsx). When called from
        // setAutoNotesEnabled / setAutoNotesIntervalMin (user changing settings),
        // skipImmediateFire is true so we do not create an unwanted note.
        if (!skipImmediateFire) {
          void get().generateDayNotes('auto');
        }
        runtimeEffects.setAutoNotesTimer(
          setInterval(() => void get().generateDayNotes('auto'), autoNotesIntervalMin * 60 * 1000),
        );
      }
    },

    clearNotesError: () => {
      set({ notesError: null });
    },
  };
}

/**
 * Read the GitHub PAT from the Keychain (null when absent). A rejection is a
 * genuine Keychain access failure, not "no token" — log it and degrade to null.
 */
async function resolveToken(): Promise<string | null> {
  return invoke<string | null>('get_token').catch((e: unknown) => {
    console.error('[keychain] get_token failed', errorMessage(e));
    return null;
  });
}

/**
 * Fetch the user's recent GitHub events within the window. Requires a token and
 * a resolvable login; any failure degrades to an empty list.
 */
async function gatherUserEvents(
  token: string | null,
  windowStart: string,
): Promise<Awaited<ReturnType<typeof fetchUserEvents>>> {
  const login = token ? await fetchUserLogin(token).catch(() => null) : null;
  return login && token ? await fetchUserEvents(login, token, windowStart).catch(() => []) : [];
}

/**
 * Ask the on-device sidecar for the executive-summary narrative. Any
 * spawn/parse failure (or an ok:false response) degrades to the stats-only
 * fallback summary so a note is always produced.
 */
async function fetchExecSummary(
  cappedRepoData: Array<{ name: string; commits: string[] }>,
): Promise<{ execSummary: string; model: string }> {
  let execSummary = '_Apple Intelligence summary unavailable — stats compiled locally._';
  let model = 'local-stats';
  try {
    const raw = await invoke<string>('ai_day_notes', { repos: cappedRepoData });
    const parsed = JSON.parse(raw) as {
      ok: boolean;
      body?: string;
      model?: string;
      error?: string;
    };
    if (parsed.ok && parsed.body) {
      execSummary = parsed.body.trim();
      model = parsed.model ?? 'apple/foundation-models';
    }
  } catch {
    // Sidecar spawn/parse failure — keep the fallback summary.
  }
  return { execSummary, model };
}
