import { describe, it, expect } from 'vitest';
import type { PostFormat, PublisherTarget, PublisherVariation } from '../types';
import {
  VALID_FORMATS,
  defaultFormatFor,
  joinSegments,
  parsePublisherOutput,
  segmentLabel,
} from './publisherFormats';

// ── VALID_FORMATS matrix ──────────────────────────────────────────────────────

describe('VALID_FORMATS', () => {
  const ALL_TARGETS: PublisherTarget[] = [
    'linkedin',
    'x',
    'instagram',
    'tiktok',
    'facebook',
    'reddit',
  ];
  const ALL_FORMATS: PostFormat[] = ['single', 'thread', 'carousel', 'story', 'script'];

  it('has an entry for all 6 targets', () => {
    for (const target of ALL_TARGETS) {
      expect(VALID_FORMATS).toHaveProperty(target);
    }
    expect(Object.keys(VALID_FORMATS)).toHaveLength(6);
  });

  it('has no extra keys beyond the 6 targets', () => {
    const keys = Object.keys(VALID_FORMATS) as PublisherTarget[];
    expect(keys.sort()).toEqual([...ALL_TARGETS].sort());
  });

  it('contains only valid PostFormat values', () => {
    for (const [, formats] of Object.entries(VALID_FORMATS)) {
      for (const f of formats) {
        expect(ALL_FORMATS).toContain(f);
      }
    }
  });

  it('matches the specified matrix exactly', () => {
    expect(VALID_FORMATS.linkedin).toEqual(['single', 'carousel', 'story']);
    expect(VALID_FORMATS.x).toEqual(['single', 'thread']);
    expect(VALID_FORMATS.instagram).toEqual(['carousel', 'script']);
    expect(VALID_FORMATS.tiktok).toEqual(['script']);
    expect(VALID_FORMATS.facebook).toEqual(['single']);
    expect(VALID_FORMATS.reddit).toEqual(['story']);
  });

  it('every default format is in the valid list for its target', () => {
    for (const target of ALL_TARGETS) {
      const def = defaultFormatFor(target);
      expect(VALID_FORMATS[target]).toContain(def);
    }
  });
});

// ── defaultFormatFor ──────────────────────────────────────────────────────────

describe('defaultFormatFor', () => {
  it('returns the specified default for each target', () => {
    expect(defaultFormatFor('linkedin')).toBe('single');
    expect(defaultFormatFor('x')).toBe('thread');
    expect(defaultFormatFor('instagram')).toBe('carousel');
    expect(defaultFormatFor('tiktok')).toBe('script');
    expect(defaultFormatFor('facebook')).toBe('single');
    expect(defaultFormatFor('reddit')).toBe('story');
  });

  it('is exhaustive — covers all 6 targets without throwing', () => {
    const targets: PublisherTarget[] = [
      'linkedin',
      'x',
      'instagram',
      'tiktok',
      'facebook',
      'reddit',
    ];
    for (const t of targets) {
      expect(() => defaultFormatFor(t)).not.toThrow();
    }
  });
});

// ── segmentLabel ──────────────────────────────────────────────────────────────

describe('segmentLabel', () => {
  it('thread: "Tweet {n}/{total}" (1-based)', () => {
    expect(segmentLabel('thread', 0, 5)).toBe('Tweet 1/5');
    expect(segmentLabel('thread', 1, 5)).toBe('Tweet 2/5');
    expect(segmentLabel('thread', 4, 5)).toBe('Tweet 5/5');
  });

  it('carousel: "Slide {n}/{total}" (1-based)', () => {
    expect(segmentLabel('carousel', 0, 8)).toBe('Slide 1/8');
    expect(segmentLabel('carousel', 2, 8)).toBe('Slide 3/8');
  });

  it('script: "Beat {n}/{total}" (1-based)', () => {
    expect(segmentLabel('script', 0, 4)).toBe('Beat 1/4');
    expect(segmentLabel('script', 3, 4)).toBe('Beat 4/4');
  });

  it('single returns empty string', () => {
    expect(segmentLabel('single', 0, 1)).toBe('');
  });

  it('story returns empty string', () => {
    expect(segmentLabel('story', 0, 1)).toBe('');
  });
});

// ── joinSegments ──────────────────────────────────────────────────────────────

function makeVariation(segments: string[], title: string | null = null): PublisherVariation {
  return {
    id: 'v0',
    title,
    segments: segments.map((text) => ({ text })),
  };
}

describe('joinSegments', () => {
  it('thread: numbered with "n/" pattern, separated by blank lines', () => {
    const v = makeVariation(['Hello world', 'Second tweet', 'Third tweet']);
    const result = joinSegments(v, 'thread');
    expect(result).toBe('1/ Hello world\n\n2/ Second tweet\n\n3/ Third tweet');
  });

  it('carousel: each segment has a [Slide n] header, separated by blank lines', () => {
    const v = makeVariation(['First slide', 'Second slide']);
    const result = joinSegments(v, 'carousel');
    expect(result).toBe('[Slide 1]\nFirst slide\n\n[Slide 2]\nSecond slide');
  });

  it('script: segments joined with blank lines, no numbering', () => {
    const v = makeVariation(['Beat one', 'Beat two', 'Beat three']);
    const result = joinSegments(v, 'script');
    expect(result).toBe('Beat one\n\nBeat two\n\nBeat three');
  });

  it('single: returns the first segment text only', () => {
    const v = makeVariation(['The only paragraph.']);
    expect(joinSegments(v, 'single')).toBe('The only paragraph.');
  });

  it('story: returns body only when title is null', () => {
    const v = makeVariation(['Story body.'], null);
    expect(joinSegments(v, 'story')).toBe('Story body.');
  });

  it('story: prefixes body with title when title is present', () => {
    const v = makeVariation(['Story body.'], 'My Title');
    expect(joinSegments(v, 'story')).toBe('My Title\n\nStory body.');
  });

  it('returns empty string for a variation with no segments', () => {
    const v: PublisherVariation = { id: 'v0', title: null, segments: [] };
    expect(joinSegments(v, 'thread')).toBe('');
    expect(joinSegments(v, 'single')).toBe('');
  });
});

// ── parsePublisherOutput ──────────────────────────────────────────────────────

describe('parsePublisherOutput', () => {
  // ── Fenced JSON ─────────────────────────────────────────────────────────────

  it('strips a ```json ... ``` fence and parses the envelope', () => {
    const raw = `\`\`\`json
{"variations":[{"id":"v0","title":"T","segments":[{"text":"Hello"}]}]}
\`\`\``;
    const result = parsePublisherOutput(raw);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('T');
    expect(result[0].segments[0].text).toBe('Hello');
  });

  it('strips a plain ``` ... ``` fence (no language tag)', () => {
    const raw = '```\n[{"segments":[{"text":"Bare"}]}]\n```';
    const result = parsePublisherOutput(raw);
    expect(result).toHaveLength(1);
    expect(result[0].segments[0].text).toBe('Bare');
  });

  // ── Bare array ───────────────────────────────────────────────────────────────

  it('accepts a bare JSON array without a variations envelope', () => {
    const raw = JSON.stringify([
      { title: 'A', segments: [{ text: 'First' }] },
      { title: 'B', segments: [{ text: 'Second' }] },
    ]);
    const result = parsePublisherOutput(raw);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('A');
    expect(result[1].title).toBe('B');
  });

  // ── {variations: [...]} envelope ─────────────────────────────────────────────

  it('accepts a {variations:[...]} envelope', () => {
    const raw = JSON.stringify({
      variations: [
        { title: null, segments: [{ text: 'Var one' }, { text: 'Var one cont.' }] },
        { title: 'Take 2', segments: [{ text: 'Var two' }] },
      ],
    });
    const result = parsePublisherOutput(raw);
    expect(result).toHaveLength(2);
    expect(result[0].segments).toHaveLength(2);
    expect(result[1].title).toBe('Take 2');
  });

  // ── Multi-segment ─────────────────────────────────────────────────────────────

  it('preserves multi-segment variations in order', () => {
    const raw = JSON.stringify([{ segments: [{ text: 'S1' }, { text: 'S2' }, { text: 'S3' }] }]);
    const result = parsePublisherOutput(raw);
    expect(result[0].segments.map((s) => s.text)).toEqual(['S1', 'S2', 'S3']);
  });

  // ── Deterministic ids ─────────────────────────────────────────────────────────

  it('assigns ids v0, v1, v2 … deterministically by index', () => {
    const raw = JSON.stringify([
      { segments: [{ text: 'A' }] },
      { segments: [{ text: 'B' }] },
      { segments: [{ text: 'C' }] },
    ]);
    const result = parsePublisherOutput(raw);
    expect(result[0].id).toBe('v0');
    expect(result[1].id).toBe('v1');
    expect(result[2].id).toBe('v2');
  });

  it('overwrites any id supplied in the raw payload (always uses vN)', () => {
    const raw = JSON.stringify([{ id: 'some-other-id', segments: [{ text: 'X' }] }]);
    const result = parsePublisherOutput(raw);
    expect(result[0].id).toBe('v0');
  });

  // ── title coercion ────────────────────────────────────────────────────────────

  it('coerces absent title to null', () => {
    const raw = JSON.stringify([{ segments: [{ text: 'No title' }] }]);
    const result = parsePublisherOutput(raw);
    expect(result[0].title).toBeNull();
  });

  // ── Flat {text} variation (no segments array) ─────────────────────────────────

  it('wraps a flat {text} variation in a single segment', () => {
    const raw = JSON.stringify([{ title: null, text: 'Flat body here.' }]);
    const result = parsePublisherOutput(raw);
    expect(result[0].segments).toHaveLength(1);
    expect(result[0].segments[0].text).toBe('Flat body here.');
  });

  // ── Garbage / parse failure fallback ─────────────────────────────────────────

  it('falls back to a single variation with raw text on invalid JSON', () => {
    const raw = 'This is definitely not JSON at all.';
    const result = parsePublisherOutput(raw);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('v0');
    expect(result[0].title).toBeNull();
    expect(result[0].segments[0].text).toBe('This is definitely not JSON at all.');
  });

  it('falls back on empty string input', () => {
    const result = parsePublisherOutput('');
    expect(result).toHaveLength(1);
    expect(result[0].segments[0].text).toBe('');
  });

  it('falls back on a JSON object that is not an array or {variations} envelope', () => {
    const raw = JSON.stringify({ something: 'unexpected' });
    const result = parsePublisherOutput(raw);
    expect(result).toHaveLength(1);
    // The fallback segment is the raw text trimmed
    expect(result[0].segments[0].text).toBe(raw.trim());
  });

  it('never throws on any input', () => {
    const inputs = [
      '',
      'garbage',
      '```',
      '```json\nnot-json\n```',
      JSON.stringify(null),
      JSON.stringify(42),
    ];
    for (const input of inputs) {
      expect(() => parsePublisherOutput(input)).not.toThrow();
    }
  });
});
