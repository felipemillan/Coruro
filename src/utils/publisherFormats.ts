/**
 * publisherFormats.ts — Pure utility for Publisher format/target logic.
 *
 * Imports ONLY from ../types. No I/O, no clock, no side effects.
 * All functions are deterministic given their input.
 */

import type { PostFormat, PublisherTarget, PublisherVariation } from '../types';

// ── Format / target matrix ────────────────────────────────────────────────────

/**
 * The set of valid formats for each publishing target.
 * Drives the format selector in the compose UI and the prompt builder.
 */
export const VALID_FORMATS: Record<PublisherTarget, PostFormat[]> = {
  linkedin: ['single', 'carousel', 'story'],
  x: ['single', 'thread'],
  instagram: ['carousel', 'script'],
  tiktok: ['script'],
  facebook: ['single'],
  reddit: ['story'],
};

/**
 * The recommended default format for a given target.
 * Used when the user picks a new target and the current format is no longer valid.
 */
export function defaultFormatFor(target: PublisherTarget): PostFormat {
  const defaults: Record<PublisherTarget, PostFormat> = {
    linkedin: 'single',
    x: 'thread',
    instagram: 'carousel',
    tiktok: 'script',
    facebook: 'single',
    reddit: 'story',
  };
  return defaults[target];
}

// ── Segment labelling ─────────────────────────────────────────────────────────

/**
 * Returns a human-readable label for a segment at position `index` (0-based)
 * in a variation that has `total` segments for the given `format`.
 *
 * - thread  → "Tweet 2/5"
 * - carousel → "Slide 3/8"
 * - script  → "Beat 1/4"
 * - single / story → "" (no label — these are one-piece formats)
 */
export function segmentLabel(format: PostFormat, index: number, total: number): string {
  switch (format) {
    case 'thread':
      return `Tweet ${index + 1}/${total}`;
    case 'carousel':
      return `Slide ${index + 1}/${total}`;
    case 'script':
      return `Beat ${index + 1}/${total}`;
    case 'single':
    case 'story':
      return '';
  }
}

// ── Join segments for "copy all" ──────────────────────────────────────────────

/**
 * Join all segments in a variation into a single copy-ready string.
 *
 * - thread   → segments numbered in Twitter/X format: "1/ <text>\n\n2/ <text>"
 * - carousel → segments separated by blank lines with a slide divider
 * - script   → segments separated by blank lines (beats flow together)
 * - single   → the single segment text (title unused)
 * - story    → body prefixed by the title on its own line if title is present
 *
 * @param variation  The generated variation to serialise.
 * @param format     The PostFormat that governs joining strategy.
 */
export function joinSegments(variation: PublisherVariation, format: PostFormat): string {
  const { title, segments } = variation;

  if (segments.length === 0) return '';

  switch (format) {
    case 'thread':
      return segments.map((s, i) => `${i + 1}/ ${s.text}`).join('\n\n');

    case 'carousel': {
      const parts = segments.map((s, i) => `[Slide ${i + 1}]\n${s.text}`);
      return parts.join('\n\n');
    }

    case 'script':
      return segments.map((s) => s.text).join('\n\n');

    case 'single':
      return segments[0].text;

    case 'story': {
      const body = segments[0].text;
      return title ? `${title}\n\n${body}` : body;
    }
  }
}

// ── Output parser ─────────────────────────────────────────────────────────────

/**
 * Parse raw model output into an array of `PublisherVariation` objects.
 *
 * Handling chain (in order):
 * 1. Strip triple-backtick code fences (with or without a `json` language tag).
 * 2. JSON.parse the cleaned string.
 * 3. Accept a top-level `{variations: [...]}` envelope OR a bare array.
 * 4. Coerce every item to `{id, title, segments}`:
 *    - `id` is `'v' + index` (deterministic, no Math.random / Date.now).
 *    - `title` defaults to `null` if absent.
 *    - `segments` is coerced: if item already has `segments`, use them;
 *      if item has a `text` string, wrap it in `[{text}]`;
 *      otherwise stringify the value as a single segment.
 *
 * On ANY parse failure the function returns a single-variation fallback whose
 * one segment is the raw string (trimmed). It never throws.
 */
export function parsePublisherOutput(raw: string): PublisherVariation[] {
  // ── Step 1: strip code fences ─────────────────────────────────────────────
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // ── Step 2–4: parse and coerce ────────────────────────────────────────────
  try {
    const parsed: unknown = JSON.parse(stripped);

    // Accept {variations: [...]} envelope or bare array
    let items: unknown[];
    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'variations' in parsed &&
      Array.isArray((parsed as { variations: unknown }).variations)
    ) {
      items = (parsed as { variations: unknown[] }).variations;
    } else {
      // Unknown shape — treat as fallback
      throw new Error('unrecognised shape');
    }

    return items.map((item, index) => coerceVariation(item, index));
  } catch {
    // ── Fallback: raw text as a single segment ────────────────────────────
    return [
      {
        id: 'v0',
        title: null,
        segments: [{ text: raw.trim() }],
      },
    ];
  }
}

// ── Internal coercion helper ──────────────────────────────────────────────────

function coerceVariation(item: unknown, index: number): PublisherVariation {
  const id = `v${index}`;

  if (item === null || typeof item !== 'object') {
    return {
      id,
      title: null,
      segments: [{ text: String(item ?? '').trim() }],
    };
  }

  const obj = item as Record<string, unknown>;

  const title: string | null = typeof obj['title'] === 'string' ? obj['title'] : null;

  let segments: Array<{ text: string }>;

  if (Array.isArray(obj['segments'])) {
    // Already segmented — coerce each element to {text}
    segments = (obj['segments'] as unknown[]).map((seg) => {
      if (seg !== null && typeof seg === 'object' && 'text' in seg) {
        return { text: String((seg as { text: unknown }).text ?? '').trim() };
      }
      return { text: String(seg ?? '').trim() };
    });
  } else if (typeof obj['text'] === 'string') {
    // Flat variation — wrap body in a single segment
    segments = [{ text: obj['text'].trim() }];
  } else {
    // Last resort — stringify whatever is here
    segments = [{ text: JSON.stringify(obj).trim() }];
  }

  return { id, title, segments };
}
