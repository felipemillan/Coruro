import { describe, it, expect } from 'vitest';
import { assembleContext, inputHash, MAX_PAYLOAD_CHARS } from './aiContext';

describe('assembleContext', () => {
  it('caps commits, entries, readme, and total size', () => {
    const ctx = assembleContext({
      repoName: 'MyGITdash',
      description: 'Git dashboard',
      languages: ['Rust', 'TypeScript', 'CSS', 'HTML', 'Shell', 'Go'],
      recentCommits: Array.from({ length: 40 }, (_, i) => `commit subject number ${i}`),
      topEntries: Array.from({ length: 60 }, (_, i) => `entry${i}`),
      readme: 'x'.repeat(5000),
    });
    expect(ctx.languages.length).toBeLessThanOrEqual(5);
    expect(ctx.recentCommits.length).toBeLessThanOrEqual(15);
    expect(ctx.topEntries.length).toBeLessThanOrEqual(25);
    expect((ctx.readme ?? '').length).toBeLessThanOrEqual(1200);
    const total = JSON.stringify(ctx).length;
    expect(total).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
  });

  it('truncates overly long commit subjects to 100 chars', () => {
    const ctx = assembleContext({
      repoName: 'r', description: null, languages: [],
      recentCommits: ['y'.repeat(200)], topEntries: [], readme: null,
    });
    expect(ctx.recentCommits[0].length).toBeLessThanOrEqual(100);
  });
});

describe('inputHash', () => {
  it('is stable for identical input and changes when input changes', () => {
    const a = assembleContext({ repoName: 'r', description: 'd', languages: ['Rust'], recentCommits: ['c'], topEntries: ['src'], readme: null });
    const b = assembleContext({ repoName: 'r', description: 'd', languages: ['Rust'], recentCommits: ['c'], topEntries: ['src'], readme: null });
    const c = assembleContext({ repoName: 'r', description: 'd2', languages: ['Rust'], recentCommits: ['c'], topEntries: ['src'], readme: null });
    expect(inputHash(a)).toBe(inputHash(b));
    expect(inputHash(a)).not.toBe(inputHash(c));
  });
});
