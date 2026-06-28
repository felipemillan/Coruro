import { describe, it, expect } from 'vitest';
import {
  buildPublisherPrompt,
  PUBLISHER_FORBIDDEN_BUZZWORDS,
  FORBIDDEN_LINE_MARKER,
} from './publisherPrompt';
import type { PublisherTarget, PostFormat, PublisherIntent } from '../types';
import { PUBLISHER_INTENTS } from '../types';

function baseInput(over: Partial<Parameters<typeof buildPublisherPrompt>[0]> = {}) {
  return {
    repoName: 'Coruro',
    target: 'linkedin' as PublisherTarget,
    format: 'single' as PostFormat,
    intent: 'story' as PublisherIntent,
    guidance: '',
    count: 3,
    authorVoice: '',
    recentCommits: [
      'feat: add assisted-manual publisher tab',
      'fix: clamp asset render to file:// only',
    ],
    stats: '42 commits across 3 branches in the last week',
    readmeExcerpt: 'Coruro is a Tauri 2 git dashboard with on-device AI.',
    ...over,
  };
}

/** Returns the prompt with the single forbidden-list line removed. */
function withoutForbiddenLine(prompt: string): string {
  return prompt
    .split('\n')
    .filter((line) => !line.includes(FORBIDDEN_LINE_MARKER))
    .join('\n');
}

describe('buildPublisherPrompt', () => {
  describe('layer 1 — identity', () => {
    it('injects the author voice verbatim at the top', () => {
      const voice = 'Felipe, a builder-marketer who writes plain and direct';
      const prompt = buildPublisherPrompt(baseInput({ authorVoice: voice }));
      expect(prompt).toContain('Write as this author.');
      expect(prompt).toContain(`Identity and voice: ${voice}.`);
      expect(prompt).toContain('not a brand');
      // identity must lead the prompt
      expect(prompt.indexOf('Write as this author.')).toBeLessThan(prompt.indexOf('VOICE'));
    });

    it('falls back to the engineer who wrote the code when voice is empty', () => {
      const prompt = buildPublisherPrompt(baseInput({ authorVoice: '   ' }));
      expect(prompt).toContain('Identity and voice: the engineer who wrote this code.');
    });
  });

  describe('layer 2 — intent + guidance (the angle)', () => {
    it('injects the intent angle line for the chosen intent', () => {
      const prompt = buildPublisherPrompt(baseInput({ intent: 'hot_take' }));
      expect(prompt).toContain('ANGLE: state a contrarian opinion plainly');
      expect(prompt).toContain('The post is ABOUT this, not about the codebase.');
    });

    it('pins the angle directly under identity, above the voice guide', () => {
      const prompt = buildPublisherPrompt(baseInput({ intent: 'lesson' }));
      const idx = prompt.indexOf('ANGLE:');
      expect(prompt.indexOf('Write as this author.')).toBeLessThan(idx);
      expect(idx).toBeLessThan(prompt.indexOf('VOICE'));
    });

    it('appends author guidance as binding direction when provided', () => {
      const prompt = buildPublisherPrompt(
        baseInput({ guidance: 'mention the 3am debugging session' }),
      );
      expect(prompt).toContain('Extra direction from the author (treat as binding):');
      expect(prompt).toContain('mention the 3am debugging session');
    });

    it('omits the guidance line entirely when guidance is empty or whitespace', () => {
      expect(buildPublisherPrompt(baseInput({ guidance: '' }))).not.toContain(
        'Extra direction from the author',
      );
      expect(buildPublisherPrompt(baseInput({ guidance: '   ' }))).not.toContain(
        'Extra direction from the author',
      );
    });

    it('keeps every baked INTENT_GUIDE angle free of forbidden words', () => {
      for (const intent of PUBLISHER_INTENTS) {
        const body = withoutForbiddenLine(
          buildPublisherPrompt(baseInput({ intent })),
        ).toLowerCase();
        for (const word of PUBLISHER_FORBIDDEN_BUZZWORDS) {
          const re = new RegExp(`\\b${word.toLowerCase().replace(/[-]/g, '\\-')}\\b`);
          expect(re.test(body)).toBe(false);
        }
      }
    });
  });

  describe('layer 2 — general voice guide + forbidden words', () => {
    it('always injects the general voice guide', () => {
      for (const target of ['linkedin', 'x', 'reddit'] as PublisherTarget[]) {
        expect(buildPublisherPrompt(baseInput({ target }))).toContain('VOICE');
      }
    });

    it('names every forbidden word in the dedicated banned-words line', () => {
      const prompt = buildPublisherPrompt(baseInput());
      const forbiddenLine = prompt.split('\n').find((l) => l.includes(FORBIDDEN_LINE_MARKER));
      expect(forbiddenLine).toBeDefined();
      for (const word of PUBLISHER_FORBIDDEN_BUZZWORDS) {
        expect(forbiddenLine!.toLowerCase()).toContain(word.toLowerCase());
      }
    });

    it('never uses a forbidden word as ambient copy anywhere else in the prompt', () => {
      // Cover every target/format combo so no baked guide leaks a banned word.
      const targets: PublisherTarget[] = [
        'linkedin',
        'x',
        'instagram',
        'tiktok',
        'facebook',
        'reddit',
      ];
      const formats: PostFormat[] = ['single', 'thread', 'carousel', 'story', 'script'];
      for (const target of targets) {
        for (const format of formats) {
          const body = withoutForbiddenLine(
            buildPublisherPrompt(baseInput({ target, format })),
          ).toLowerCase();
          for (const word of PUBLISHER_FORBIDDEN_BUZZWORDS) {
            const re = new RegExp(`\\b${word.toLowerCase().replace(/[-]/g, '\\-')}\\b`);
            expect(re.test(body)).toBe(false);
          }
        }
      }
    });

    it('also bans announcement and journey phrases in the instruction line', () => {
      const prompt = buildPublisherPrompt(baseInput());
      expect(prompt).toContain("I'd be happy to");
      expect(prompt.toLowerCase()).toContain('journey-language');
    });
  });

  describe('layer 3 — reddit guide (conditional)', () => {
    it('includes the reddit guide only when target is reddit', () => {
      expect(buildPublisherPrompt(baseInput({ target: 'reddit' }))).toContain('REDDIT');
      for (const target of [
        'linkedin',
        'x',
        'instagram',
        'tiktok',
        'facebook',
      ] as PublisherTarget[]) {
        expect(buildPublisherPrompt(baseInput({ target }))).not.toContain('REDDIT\n');
      }
    });

    it('carries the reddit title rules when target is reddit', () => {
      const prompt = buildPublisherPrompt(baseInput({ target: 'reddit' }));
      expect(prompt).toContain('under 80 characters');
      expect(prompt.toLowerCase()).toContain('no colons');
    });
  });

  describe('layer 4 — target framing (all 6 networks)', () => {
    it('produces distinct framing per network', () => {
      const targets: PublisherTarget[] = [
        'linkedin',
        'x',
        'instagram',
        'tiktok',
        'facebook',
        'reddit',
      ];
      const prompts = targets.map((t) => buildPublisherPrompt(baseInput({ target: t })));
      // all distinct
      expect(new Set(prompts).size).toBe(targets.length);
      expect(prompts[0]).toContain('LinkedIn');
      expect(prompts[1]).toContain('280 characters');
      expect(prompts[2]).toContain('Instagram');
      expect(prompts[3]).toContain('TikTok');
      expect(prompts[4]).toContain('Facebook');
      expect(prompts[5]).toContain('Reddit');
    });
  });

  describe('layer 5 — format framing', () => {
    it('carries the segment shape for each format', () => {
      expect(buildPublisherPrompt(baseInput({ format: 'single' }))).toContain('Exactly 1 segment');
      expect(buildPublisherPrompt(baseInput({ format: 'thread' }))).toContain('2 to 10 segments');
      expect(buildPublisherPrompt(baseInput({ format: 'carousel' }))).toContain('3 to 10 segments');
      expect(buildPublisherPrompt(baseInput({ format: 'story' }))).toContain('non-null title');
      expect(buildPublisherPrompt(baseInput({ format: 'script' }))).toContain('3 to 6 segments');
    });
  });

  describe('layer 6 — count', () => {
    it('requests exactly N variations with distinct hooks', () => {
      const prompt = buildPublisherPrompt(baseInput({ count: 4 }));
      expect(prompt).toContain('exactly 4 variations');
      expect(prompt.toLowerCase()).toContain('different hook');
    });

    it('handles singular count grammatically', () => {
      const prompt = buildPublisherPrompt(baseInput({ count: 1 }));
      expect(prompt).toContain('exactly 1 variation.');
    });
  });

  describe('layer 7 — grounding', () => {
    it('includes repo name, commits, stats, and README excerpt', () => {
      const prompt = buildPublisherPrompt(
        baseInput({
          repoName: 'MyCoolRepo',
          recentCommits: ['feat: thing one', 'chore: thing two'],
          stats: 'STATS-SENTINEL-123',
          readmeExcerpt: 'README-SENTINEL-456',
        }),
      );
      expect(prompt).toContain('MyCoolRepo');
      expect(prompt).toContain('feat: thing one');
      expect(prompt).toContain('chore: thing two');
      expect(prompt).toContain('STATS-SENTINEL-123');
      expect(prompt).toContain('README-SENTINEL-456');
    });

    it('instructs the model not to invent features', () => {
      expect(buildPublisherPrompt(baseInput()).toLowerCase()).toContain('do not invent');
    });

    it('subordinates the tech: evidence serves the angle, never leads', () => {
      const prompt = buildPublisherPrompt(baseInput());
      expect(prompt).toContain('SUPPORTING EVIDENCE for the angle, never the subject');
      expect(prompt).toContain('Do not lead');
      expect(prompt.toLowerCase()).toContain('serve the angle');
      expect(prompt.toLowerCase()).toContain('never a tech inventory');
    });

    it('falls back gracefully when context is empty', () => {
      const prompt = buildPublisherPrompt({
        repoName: 'Empty',
        target: 'reddit',
        format: 'single',
        intent: 'story',
        guidance: '',
        count: 1,
        authorVoice: '',
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

  describe('layer 8 — output contract', () => {
    it('demands a bare JSON variations object with no prose or fence', () => {
      const prompt = buildPublisherPrompt(baseInput());
      expect(prompt).toContain('{"variations":[{"title": string|null, "segments": [string]}]}');
      expect(prompt).toContain('JSON only');
      expect(prompt.toLowerCase()).toContain('no code fence');
    });

    it('makes title non-null for reddit and story, null otherwise', () => {
      expect(buildPublisherPrompt(baseInput({ target: 'reddit' }))).toContain(
        'title is a short non-null string.',
      );
      expect(buildPublisherPrompt(baseInput({ format: 'story' }))).toContain(
        'title is a short non-null string.',
      );
      expect(buildPublisherPrompt(baseInput({ target: 'linkedin', format: 'single' }))).toContain(
        'title is null.',
      );
    });
  });
});
