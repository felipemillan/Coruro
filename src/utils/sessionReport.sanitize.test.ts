import { describe, it, expect } from 'vitest';
import { sanitizeExecSummary, EXEC_SUMMARY_LOCAL } from './sessionReport';

describe('sanitizeExecSummary — deterministic anti-hallucination gate', () => {
  it('passes a clean qualitative summary through unchanged', () => {
    const s = 'I refactored Coruro into focused modules and hardened the sidecar pipeline.';
    expect(sanitizeExecSummary(s)).toBe(s);
  });

  it('strips a leaked time-span claim ("today")', () => {
    const out = sanitizeExecSummary('Today I refactored Coruro and fixed the day-notes timer.');
    expect(out.toLowerCase()).not.toContain('today');
    expect(out).toContain('refactored Coruro');
  });

  it('strips multi-word time spans ("over the past week", "this morning")', () => {
    expect(
      sanitizeExecSummary('Over the past week I built the notes feature.').toLowerCase(),
    ).not.toContain('past week');
    expect(sanitizeExecSummary('This morning I cleaned up the store.').toLowerCase()).not.toContain(
      'this morning',
    );
  });

  it('removes stray numeric tokens (report owns the exact stats)', () => {
    const out = sanitizeExecSummary('I split 7 files and removed 1,209 lines from the store.');
    expect(out).not.toMatch(/\b\d/);
    expect(out).toContain('files');
    expect(out).toContain('store');
  });

  it('preserves alphanumeric identifiers like web3 or s2n', () => {
    const out = sanitizeExecSummary('I upgraded the web3 adapter and patched s2n.');
    expect(out).toContain('web3');
    expect(out).toContain('s2n');
  });

  it('collapses whitespace and tidies punctuation left by removals', () => {
    const out = sanitizeExecSummary('I changed 3 files , then refactored.');
    expect(out).not.toMatch(/\s{2,}/);
    expect(out).not.toMatch(/\s+,/);
    expect(out).toContain('refactored');
  });

  it('returns the fallback sentinel when nothing usable survives', () => {
    expect(sanitizeExecSummary('Today. 3 7 1,209.')).toBe(EXEC_SUMMARY_LOCAL);
    expect(sanitizeExecSummary('   ')).toBe(EXEC_SUMMARY_LOCAL);
    expect(sanitizeExecSummary('')).toBe(EXEC_SUMMARY_LOCAL);
  });

  it('keeps the fallback placeholder untouched (idempotent on its own sentinel)', () => {
    expect(sanitizeExecSummary(EXEC_SUMMARY_LOCAL)).toBe(EXEC_SUMMARY_LOCAL);
  });
});

describe('sanitizeExecSummary — number preservation (WI-2.2)', () => {
  it('preserves version tags and issue/PR refs verbatim', () => {
    expect(sanitizeExecSummary('Worked on v2 API and #42 PR fix')).toBe(
      'Worked on v2 API and #42 PR fix',
    );
  });

  it('strips bare count numbers but keeps the surrounding prose', () => {
    const out = sanitizeExecSummary('Shipped 3 bug fixes across 7 files');
    expect(out).not.toMatch(/\b\d/);
    expect(out).toContain('bug fixes');
    expect(out).toContain('files');
  });

  it('keeps a version number in an explicit version context (React 19 upgrade)', () => {
    expect(sanitizeExecSummary('React 19 upgrade landed')).toContain('19');
  });

  it('preserves letter-glued identifiers P1 and S3', () => {
    const out = sanitizeExecSummary('Closed P1 and S3 issues');
    expect(out).toContain('P1');
    expect(out).toContain('S3');
  });
});
