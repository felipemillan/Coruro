import { describe, it, expect } from 'vitest';
import { buildPublisherPrompt, PUBLISHER_FORBIDDEN_BUZZWORDS } from './publisherPrompt';
import type { PublisherTarget } from '../types';

function baseInput(over: Partial<Parameters<typeof buildPublisherPrompt>[0]> = {}) {
  return {
    repoName: 'Coruro',
    target: 'linkedin' as PublisherTarget,
    recentCommits: [
      'feat: add assisted-manual publisher tab',
      'fix: clamp asset render to file:// only',
    ],
    stats: '42 commits across 3 branches in the last week',
    readmeExcerpt: 'Coruro is a Tauri 2 git dashboard with on-device AI.',
    ...over,
  };
}

describe('buildPublisherPrompt', () => {
  it('produces buzzword-free output across both targets', () => {
    for (const target of ['linkedin', 'reddit'] as PublisherTarget[]) {
      const prompt = buildPublisherPrompt(baseInput({ target }));
      const lower = prompt.toLowerCase();
      for (const word of PUBLISHER_FORBIDDEN_BUZZWORDS) {
        // The forbidden word only ever appears inside the instruction listing it,
        // never as ambient marketing copy. We assert the listing names every word
        // exactly once so the model is told to avoid all of them.
        const occurrences = lower.split(word.toLowerCase()).length - 1;
        expect(occurrences).toBe(1);
      }
    }
  });

  it('names every forbidden buzzword in the instruction block', () => {
    const prompt = buildPublisherPrompt(baseInput());
    for (const word of PUBLISHER_FORBIDDEN_BUZZWORDS) {
      expect(prompt.toLowerCase()).toContain(word.toLowerCase());
    }
  });

  it('includes the repo name', () => {
    const prompt = buildPublisherPrompt(baseInput({ repoName: 'MyCoolRepo' }));
    expect(prompt).toContain('MyCoolRepo');
  });

  it('includes every supplied commit verbatim', () => {
    const commits = ['feat: thing one', 'chore: thing two', 'docs: thing three'];
    const prompt = buildPublisherPrompt(baseInput({ recentCommits: commits }));
    for (const c of commits) {
      expect(prompt).toContain(c);
    }
  });

  it('includes the supplied stats and README excerpt', () => {
    const prompt = buildPublisherPrompt(
      baseInput({
        stats: 'STATS-SENTINEL-123',
        readmeExcerpt: 'README-SENTINEL-456',
      }),
    );
    expect(prompt).toContain('STATS-SENTINEL-123');
    expect(prompt).toContain('README-SENTINEL-456');
  });

  it('differs by target (LinkedIn vs Reddit framing)', () => {
    const linkedin = buildPublisherPrompt(baseInput({ target: 'linkedin' }));
    const reddit = buildPublisherPrompt(baseInput({ target: 'reddit' }));
    expect(linkedin).not.toEqual(reddit);
    expect(linkedin).toContain('LinkedIn');
    expect(reddit).toContain('Reddit');
  });

  it('instructs the model not to invent features', () => {
    const prompt = buildPublisherPrompt(baseInput()).toLowerCase();
    expect(prompt).toContain('do not invent');
  });

  it('falls back gracefully when context is empty', () => {
    const prompt = buildPublisherPrompt({
      repoName: 'Empty',
      target: 'reddit',
      recentCommits: [],
      stats: '',
      readmeExcerpt: '',
    });
    expect(prompt).toContain('Empty');
    expect(prompt).toContain('(no recent commits supplied)');
    expect(prompt).toContain('(no stats supplied)');
    expect(prompt).toContain('(no README excerpt supplied)');
  });
});
