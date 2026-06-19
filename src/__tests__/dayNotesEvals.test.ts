import { describe, it, expect } from 'vitest';
import { loadFixtures, runEvals } from '../evals/run';
import { scoreFixture } from '../evals/rubric';

describe('day-notes eval harness (WI-2.1)', () => {
  const fixtures = loadFixtures();

  it('loads 20 fixtures with at least 5 annotated gated:true', () => {
    expect(fixtures).toHaveLength(20);
    expect(fixtures.filter(({ f }) => f.gated).length).toBeGreaterThanOrEqual(5);
  });

  it('every stored gated flag matches the deterministic gate (no drift)', () => {
    for (const { id, f } of fixtures) {
      const s = scoreFixture(id, f);
      expect({ id, gated: s.computedGated }).toEqual({ id, gated: f.gated });
    }
  });

  it('runs clean over all fixtures and reports a sane aggregate', () => {
    const r = runEvals();
    expect(r.count).toBe(20);
    expect(r.gatedMismatches).toEqual([]);
    expect(r.gatePassRate).toBeGreaterThanOrEqual(0);
    expect(r.gatePassRate).toBeLessThanOrEqual(1);
    // Nothing must leak a count/time-span through the gate.
    expect(r.meanAccuracy).toBe(1);
  });
});
