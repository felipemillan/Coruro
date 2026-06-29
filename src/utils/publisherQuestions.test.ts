import { describe, it, expect } from 'vitest';
import {
  STATIC_QUESTIONS,
  staticQuestionsFor,
  buildTailorQuestionsPrompt,
  parseTailoredQuestions,
} from './publisherQuestions';
import type { PublisherIntent } from '../types';
import { PUBLISHER_FORBIDDEN_BUZZWORDS } from './publisherPrompt';

const INTENTS: PublisherIntent[] = [
  'story',
  'lesson',
  'launch',
  'behind_scenes',
  'deep_dive',
  'feedback',
  'milestone',
  'hot_take',
];

describe('STATIC_QUESTIONS', () => {
  it('has an entry for every intent', () => {
    for (const intent of INTENTS) {
      expect(STATIC_QUESTIONS[intent]).toBeDefined();
      expect(STATIC_QUESTIONS[intent].length).toBe(3);
    }
  });

  it('all ids are unique across every intent', () => {
    const all = Object.values(STATIC_QUESTIONS)
      .flat()
      .map((q) => q.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it('no static question prompt contains a forbidden buzzword', () => {
    const prompts = Object.values(STATIC_QUESTIONS)
      .flat()
      .map((q) => q.prompt.toLowerCase());
    for (const prompt of prompts) {
      for (const word of PUBLISHER_FORBIDDEN_BUZZWORDS) {
        expect(prompt).not.toContain(word.toLowerCase());
      }
    }
  });
});

describe('staticQuestionsFor', () => {
  it('returns 3 questions for a dev role (no extra)', () => {
    const qs = staticQuestionsFor('story', ['developer']);
    expect(qs).toHaveLength(3);
  });

  it('appends role-extra for growth-marketer', () => {
    const qs = staticQuestionsFor('story', ['growth-marketer']);
    expect(qs).toHaveLength(4);
    expect(qs[3].id).toBe('role-growth-angle');
  });

  it('appends role-extra for cmo', () => {
    const qs = staticQuestionsFor('launch', ['cmo']);
    expect(qs).toHaveLength(4);
    expect(qs[3].id).toBe('role-cmo-angle');
  });

  it('skips dev roles and uses the first non-dev role with an extra', () => {
    // `developer` is a PUBLISHER_DEV_ROLE → skipped by the !has guard; the loop
    // falls through to `growth-marketer`, which contributes the extra question.
    const qs = staticQuestionsFor('lesson', ['developer', 'growth-marketer']);
    expect(qs.length).toBe(4);
    expect(qs[3].id).toBe('role-growth-angle');
  });

  it('returns base only when roles is empty', () => {
    const qs = staticQuestionsFor('milestone', []);
    expect(qs).toHaveLength(3);
  });
});

describe('buildTailorQuestionsPrompt', () => {
  const base = {
    intent: 'story' as PublisherIntent,
    roles: ['founder'] as ['founder'],
    seniority: 'senior',
    audience: 'indie hackers',
    repoName: 'my-tool',
    authorVoice: 'casual builder',
    recentCommits: ['fix login bug', 'add dark mode'],
  };

  it('includes role and intent', () => {
    const p = buildTailorQuestionsPrompt(base);
    expect(p).toContain('founder');
    expect(p).toContain('story');
  });

  it('includes repoName', () => {
    const p = buildTailorQuestionsPrompt(base);
    expect(p).toContain('my-tool');
  });

  it('includes commit lines', () => {
    const p = buildTailorQuestionsPrompt(base);
    expect(p).toContain('fix login bug');
  });

  it('uses fallback when audience is blank', () => {
    const p = buildTailorQuestionsPrompt({ ...base, audience: '' });
    expect(p).toContain('general technical audience');
  });

  it('uses fallback when authorVoice is blank', () => {
    const p = buildTailorQuestionsPrompt({ ...base, authorVoice: '' });
    expect(p).toContain('a builder sharing their work');
  });

  it('emits "(none)" when recentCommits is empty', () => {
    const p = buildTailorQuestionsPrompt({ ...base, recentCommits: [] });
    expect(p).toContain('(none)');
  });

  it('caps commits at 8', () => {
    const commits = Array.from({ length: 12 }, (_, i) => `commit-${i}`);
    const p = buildTailorQuestionsPrompt({ ...base, recentCommits: commits });
    expect(p).toContain('commit-7');
    expect(p).not.toContain('commit-8');
  });

  it('instructs model to emit only JSON', () => {
    const p = buildTailorQuestionsPrompt(base);
    expect(p).toContain('Emit ONLY valid JSON');
  });
});

describe('parseTailoredQuestions', () => {
  it('parses {questions:[...]} envelope', () => {
    const raw = JSON.stringify({
      questions: [
        { id: 'q1', prompt: 'Question one?' },
        { id: 'q2', prompt: 'Question two?' },
      ],
    });
    const result = parseTailoredQuestions(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'q1', prompt: 'Question one?' });
  });

  it('parses bare array', () => {
    const raw = JSON.stringify([
      { id: 'a', prompt: 'Bare one?' },
      { id: 'b', prompt: 'Bare two?' },
    ]);
    expect(parseTailoredQuestions(raw)).toHaveLength(2);
  });

  it('strips markdown json fences', () => {
    const raw = '```json\n[{"id":"x","prompt":"Fenced?"}]\n```';
    const result = parseTailoredQuestions(raw);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe('Fenced?');
  });

  it('caps at 4 items', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, prompt: `Q${i}?` }));
    const result = parseTailoredQuestions(JSON.stringify(items));
    expect(result).toHaveLength(4);
  });

  it('skips items without a prompt', () => {
    const raw = JSON.stringify([
      { id: 'a', prompt: '' },
      { id: 'b', prompt: 'Valid?' },
    ]);
    const result = parseTailoredQuestions(raw);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('skips non-object items', () => {
    const raw = JSON.stringify(['not-an-obj', { id: 'ok', prompt: 'Fine?' }]);
    const result = parseTailoredQuestions(raw);
    expect(result).toHaveLength(1);
  });

  it('falls back to q{i} when id is missing', () => {
    const raw = JSON.stringify([{ prompt: 'No id?' }]);
    const result = parseTailoredQuestions(raw);
    expect(result[0].id).toBe('q0');
  });

  it('returns [] on invalid JSON', () => {
    expect(parseTailoredQuestions('not json')).toEqual([]);
  });

  it('returns [] on empty string', () => {
    expect(parseTailoredQuestions('')).toEqual([]);
  });

  it('returns [] when top-level is a number', () => {
    expect(parseTailoredQuestions('42')).toEqual([]);
  });

  it('trims prompt whitespace', () => {
    const raw = JSON.stringify([{ id: 'x', prompt: '  spaced?  ' }]);
    expect(parseTailoredQuestions(raw)[0].prompt).toBe('spaced?');
  });
});
