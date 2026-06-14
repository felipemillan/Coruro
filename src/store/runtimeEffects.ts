// Module-scoped mutable effects for the board store.
//
// These are deliberately NOT part of the zustand state: they are imperative
// side-effect handles (a setInterval ref, per-repo debounce timers, and a
// serialised disk-write promise chain) that must persist for the lifetime of
// the store but never trigger a React re-render. Grouping them here keeps the
// slices free of module-global `let`s and makes the lifecycle resettable
// (useful for tests and teardown).

/** Handle for the auto-notes setInterval, or null when no timer is running. */
let autoNotesTimerRef: ReturnType<typeof setInterval> | null = null;

/**
 * Per-repo debounce timers for notes saves. Keyed by repo path so editing
 * notes on one card never cancels a pending write for another.
 */
const notesSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Serialises every disk write through a single promise chain so concurrent
 * callers (debounced updateNotes + moveCard, etc.) can never interleave
 * partial writes and corrupt the state JSON. Each save() appends to the chain
 * and resolves only after its own write completes.
 */
let writeChain: Promise<void> = Promise.resolve();

export const runtimeEffects = {
  /** Read the current auto-notes timer handle. */
  getAutoNotesTimer(): ReturnType<typeof setInterval> | null {
    return autoNotesTimerRef;
  },
  /** Store (or clear, with null) the auto-notes timer handle. */
  setAutoNotesTimer(handle: ReturnType<typeof setInterval> | null): void {
    autoNotesTimerRef = handle;
  },

  /** The per-repo notes debounce-timer map. */
  notesSaveTimers,

  /**
   * Append a disk write to the serialised chain and return a promise that
   * resolves when this specific write completes. `run` performs the write.
   */
  enqueueWrite(run: () => Promise<void>): Promise<void> {
    writeChain = writeChain.then(run);
    return writeChain;
  },

  /**
   * Reset all effect state: stop the timer, clear pending debounce timers, and
   * reset the write chain. Provided for tests/teardown; not used at runtime.
   */
  reset(): void {
    if (autoNotesTimerRef) {
      clearInterval(autoNotesTimerRef);
      autoNotesTimerRef = null;
    }
    for (const t of notesSaveTimers.values()) clearTimeout(t);
    notesSaveTimers.clear();
    writeChain = Promise.resolve();
  },
};
