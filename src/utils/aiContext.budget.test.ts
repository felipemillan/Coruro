import { describe, it, expect } from 'vitest';
import {
  MAX_CONTEXT_TOKENS,
  estimatePayloadTokens,
  exceedsContextBudget,
  capItemsToContextBudget,
} from './aiContext';

describe('context token budget (invariant #5)', () => {
  it('estimates empty string as zero tokens', () => {
    expect(estimatePayloadTokens('')).toBe(0);
  });

  it('counts ASCII at ~4 chars/token', () => {
    expect(estimatePayloadTokens('a'.repeat(MAX_CONTEXT_TOKENS * 4))).toBe(MAX_CONTEXT_TOKENS);
  });

  it('allows a payload exactly at budget but rejects one char over', () => {
    expect(exceedsContextBudget('a'.repeat(MAX_CONTEXT_TOKENS * 4))).toBe(false);
    expect(exceedsContextBudget('a'.repeat(MAX_CONTEXT_TOKENS * 4 + 4))).toBe(true);
  });

  it('treats CJK as token-dense so it exceeds far sooner than ASCII', () => {
    const cjk = '計'.repeat(MAX_CONTEXT_TOKENS + 1);
    expect(exceedsContextBudget(cjk)).toBe(true);
    // The same character count in ASCII stays well within budget.
    expect(exceedsContextBudget('a'.repeat(MAX_CONTEXT_TOKENS + 1))).toBe(false);
  });

  it('caps an oversized item list to fit the budget', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i, text: 'x'.repeat(500) }));
    const serialize = (list: typeof items) => JSON.stringify({ mode: 'enrich', items: list });
    const capped = capItemsToContextBudget(items, serialize);
    expect(capped.length).toBeLessThan(items.length);
    expect(capped.length).toBeGreaterThan(0);
    expect(exceedsContextBudget(serialize(capped))).toBe(false);
  });

  it('keeps every item when the list is already within budget', () => {
    const items = [{ id: 1, text: 'small' }];
    const serialize = (list: typeof items) => JSON.stringify(list);
    expect(capItemsToContextBudget(items, serialize)).toEqual(items);
  });
});
