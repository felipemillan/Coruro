// Day-notes eval rubric (WI-2.1). Deterministic scoring of the exec-summary
// sanitizer gate against fixtures — no model, no network. The on-device model
// can't be invoked here; what we CAN measure is the deterministic gate's
// behaviour on recorded sidecar outputs, which is where quality silently rotted.

import { sanitizeExecSummary, EXEC_SUMMARY_LOCAL } from '../utils/sessionReport';

/** One recorded sidecar interaction. `gated` is the human-annotated expectation. */
export interface Fixture {
  /** Number-free lines that were (or would be) fed to the model. */
  aiLines: string[];
  /** The raw text the sidecar returned (pre-gate). */
  rawSidecarOutput: string;
  /** Expected: did the deterministic gate reject all of it? */
  gated: boolean;
}

export interface FixtureScore {
  id: string;
  /** Did the gate reject everything (sanitized === fallback sentinel)? */
  computedGated: boolean;
  /** Convenience inverse of computedGated. */
  gatePass: boolean;
  /** 0..1 — content richness of the surviving summary (0 when gated). */
  specificity: number;
  /** 0..1 — 1 unless a count/time-span token leaked through the gate. */
  accuracy: number;
}

// A parroted count that should never survive the gate, e.g. "3 files", "7 commits".
const LEAKED_COUNT_RE = /\b\d+\s+[a-z]/;
const STOP = new Set(['the', 'and', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'into', 'with']);

const bareWord = (w: string): string => w.replace(/[^a-z0-9]/g, '');

export function scoreFixture(id: string, f: Fixture): FixtureScore {
  const sanitized = sanitizeExecSummary(f.rawSidecarOutput);
  const computedGated = sanitized === EXEC_SUMMARY_LOCAL;

  const words = computedGated
    ? []
    : sanitized
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => bareWord(w).length > 0);
  const content = words.filter((w) => !STOP.has(bareWord(w)));

  return {
    id,
    computedGated,
    gatePass: !computedGated,
    // A one-line summary needs only a handful of content words to be specific.
    specificity: computedGated ? 0 : Math.min(content.length / 8, 1),
    accuracy: LEAKED_COUNT_RE.test(sanitized) ? 0 : 1,
  };
}

export interface Aggregate {
  count: number;
  gatedCount: number;
  /** Fraction of fixtures that produced a usable (non-gated) summary. */
  gatePassRate: number;
  meanSpecificity: number;
  meanAccuracy: number;
  /** Fixture ids whose stored `gated` disagrees with the deterministic gate. */
  gatedMismatches: string[];
}

export function aggregate(fixtures: Array<{ id: string; f: Fixture }>): Aggregate {
  const scored = fixtures.map(({ id, f }) => ({ score: scoreFixture(id, f), gated: f.gated }));
  const count = scored.length;
  const passes = scored.filter(({ score }) => score.gatePass).length;
  return {
    count,
    gatedCount: scored.filter(({ score }) => score.computedGated).length,
    gatePassRate: count ? passes / count : 0,
    meanSpecificity: count ? scored.reduce((n, { score }) => n + score.specificity, 0) / count : 0,
    meanAccuracy: count ? scored.reduce((n, { score }) => n + score.accuracy, 0) / count : 0,
    gatedMismatches: scored
      .filter(({ score, gated }) => score.computedGated !== gated)
      .map(({ score }) => score.id),
  };
}
