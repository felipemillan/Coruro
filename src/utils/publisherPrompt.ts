import type { PublisherTarget, PostFormat, PublisherIntent } from '../types';

// NOTE: This prompt targets a headless `claude -p` call (the `publisher_generate`
// Tauri command), the same plan-billed claude tier as the interactive PTY but
// run non-interactively from a neutral temp_dir cwd with --disallowedTools and
// no repo access. It is NOT bound by the 4096-token Apple FoundationModels
// sidecar budget — Coruro invariant 5 (the on-device sidecar token cap) does
// not apply to text generated here. Even so the baked guides below are kept
// TERSE on purpose: this is plan-billed, so every token spent on instructions
// is a token not spent on quality output.
//
// buildPublisherPrompt is a PURE function: deterministic given its input, no
// I/O, no clock, no filesystem read of the source skill docs. The two skill
// documents (social_media.md, reddit.xml) are distilled into the baked string
// constants below — they are NOT read at runtime.

/**
 * Words the generated post must never contain, in any casing. Merges the
 * original marketing buzzwords with the high-frequency "claude-ism" power
 * words distilled from reddit.xml's vocabulary database. Kept as single
 * tokens (no spaces) so callers/tests can scan output cheaply; banned
 * multi-word phrases ("I'd be happy to", journey-language) are named in the
 * instruction prose instead.
 *
 * Invariant for the guide text below: none of these tokens may appear in any
 * baked guide string EXCEPT the single forbidden-list instruction line. The
 * test enforces that.
 */
const FORBIDDEN_BUZZWORDS: readonly string[] = [
  // original marketing buzzwords
  'thrilled',
  'excited',
  'delighted',
  'passionate',
  'game-changing',
  'cutting-edge',
  'revolutionary',
  // claude-ism formal verbs / power words
  'leverage',
  'utilize',
  'seamless',
  'robust',
  'streamlined',
  'intuitive',
  'holistic',
  'nuanced',
  'genuinely',
  'comprehensive',
  'straightforward',
  'absolutely',
  'essential',
  'fundamental',
  'significant',
  'substantial',
  'valuable',
  'crucial',
  'optimal',
  'incredibly',
  // claude-ism formal transitions
  'furthermore',
  'however',
  'moreover',
  'therefore',
  'pivotal',
  'paramount',
];

/**
 * Marker that uniquely prefixes the single line listing every forbidden word.
 * Exported so the test can strip that one line and prove the rest of the
 * prompt is clean of forbidden words.
 */
export const FORBIDDEN_LINE_MARKER = 'Banned words (never use, in any casing):';

/**
 * Distilled from social_media.md. Always injected. Terse on purpose.
 * MUST NOT contain any FORBIDDEN_BUZZWORDS token (except via the forbidden
 * line, which is built separately and appended after this constant).
 */
const GENERAL_VOICE_GUIDE: string = [
  'VOICE',
  '- Hook first. The opening line decides whether anyone reads on. Pick ONE angle:',
  '  curiosity ("I was wrong about X"); story ("Last week X happened"); value',
  '  ("How to X without Y"); contrarian ("Unpopular opinion: X"); or proof',
  '  ("We shipped X in Y days, here is how").',
  '- Specific over vague. Name the real number, the real file, the real bug.',
  '  "cut the build to 9s" beats "made it faster".',
  '- Short sentences. One idea each. Break lines. Let the key point stand alone.',
  '  Vary the rhythm: short, short, then a longer line that lands.',
  '- Write from feeling, not from a feature list. Start with what the work felt',
  '  like, the annoyance you killed, the thing that finally clicked.',
  '- Sound like a person who built it, not a press release. No hype, no',
  '  exclamation spam, at most one hashtag and only if it is on point.',
].join('\n');

/**
 * Distilled from reddit.xml (SKILL.md + claude-isms + tool-mentions).
 * Injected ONLY when target === 'reddit'. Terse on purpose.
 * MUST NOT contain any FORBIDDEN_BUZZWORDS token.
 */
const REDDIT_GUIDE: string = [
  'REDDIT',
  '- Title: under 80 characters. No colons, no em-dashes. Lowercase except proper',
  '  nouns. Direct and specific, not clever. Something a tired person would type.',
  '- Tone: write to skeptical peers, not an audience. Show your work: real numbers,',
  '  real detail, real limits of what you built. Skeptical reads truer than eager.',
  '- Human markers: a couple of casual fillers (honestly, tbh, kind of, idk), wildly',
  '  varied sentence length, one small tangent, an ending that trails off instead of',
  '  a tidy wrap-up. Drop "here is what I learned", "the truth is", "at the end of',
  '  the day".',
  '- Tool restraint: if a tool gets named at all, name it once, mid-post, as a side',
  '  detail with a caveat ("not perfect, but it saves me a step"). The post must',
  '  still stand and still help if the tool mention is deleted entirely.',
  '- Soft call only: end on a real question, never "what do you think?". No hard sell.',
].join('\n');

/**
 * Per-intent angle declarations. Always injected as layer 2, directly under
 * identity, so the post's SUBJECT is fixed BEFORE any voice or grounding copy.
 * Each line names what the post is actually about — the angle — grounded in the
 * hook formulas distilled from social_media.md. v2 posts drifted into reciting
 * the stack; these lines exist to pin the angle first.
 *
 * MUST NOT contain any FORBIDDEN_BUZZWORDS token (the test scans every baked
 * guide string). Keep each line plain and concrete.
 */
const INTENT_GUIDE: Record<PublisherIntent, string> = {
  story: 'ANGLE: tell a short true story. Open with a specific moment, not a summary.',
  lesson: 'ANGLE: a lesson learned, ideally from a mistake or surprise. The takeaway is the point.',
  launch: 'ANGLE: announce what shipped and why it matters to the reader.',
  behind_scenes: 'ANGLE: show the messy real process behind building it.',
  deep_dive: 'ANGLE: teach one concrete technical thing the reader can use.',
  feedback: "ANGLE: pose a real open question and ask the reader's take.",
  milestone: 'ANGLE: mark a milestone with the human effort behind the number.',
  hot_take: 'ANGLE: state a contrarian opinion plainly, then back it. The opinion is the subject.',
};

/** Per-target framing: char limits + shape. All 6 networks. Pure data. */
function targetFraming(target: PublisherTarget): string {
  switch (target) {
    case 'linkedin':
      return [
        'NETWORK: LinkedIn (B2B, builder-to-builder).',
        '- Roughly 1,200 to 1,500 characters reads best. Hook in the first line,',
        '  before the "see more" fold. Use line breaks for scannability.',
        '- Keep any link out of the body (it kills reach); say "link in comments".',
        '- Plain technical register aimed at engineers, not marketers.',
      ].join('\n');
    case 'x':
      return [
        'NETWORK: X / Twitter (tech, real-time).',
        '- Hard limit 280 characters per post; aim under 100 for punch.',
        '- A thread runs hook (post 1) then promise then deliver then recap then a',
        '  light call. Each post carries one idea and can stand on its own.',
      ].join('\n');
    case 'instagram':
      return [
        'NETWORK: Instagram (visual-first).',
        '- The words ride on top of visuals. A carousel runs about 10 slides, one',
        '  point per slide; slide 1 hooks, the last slide sums up plus a light call.',
        '- The caption expands the idea and carries any call to act.',
      ].join('\n');
    case 'tiktok':
      return [
        'NETWORK: TikTok (short vertical video).',
        '- Write a spoken script, not an essay. Hook in the first 1 to 2 seconds.',
        '- Keep it under ~30 seconds. Native and unpolished beats produced. Use',
        '  scene beats: on-screen action plus what is said.',
      ].join('\n');
    case 'facebook':
      return [
        'NETWORK: Facebook (community, discussion).',
        '- Conversational and native. Keep external links out of the body; they',
        '  throttle reach.',
        '- End on a question that invites people to reply.',
      ].join('\n');
    case 'reddit':
      return [
        'NETWORK: Reddit (skeptical technical peers).',
        '- A plain descriptive title plus a body writeup. Matter-of-fact, specific,',
        '  no marketing voice, no "check it out" call. Follow the REDDIT rules above.',
      ].join('\n');
  }
}

/** Per-format framing: segment shape + count guidance. Pure data. */
function formatFraming(format: PostFormat): string {
  switch (format) {
    case 'single':
      return [
        'FORMAT: single post.',
        '- Exactly 1 segment: the whole post as one block of text.',
      ].join('\n');
    case 'thread':
      return [
        'FORMAT: thread.',
        '- 2 to 10 segments, each one post in the thread. Segment 1 is the hook,',
        '  the final segment is the recap plus a light call. One idea per segment.',
      ].join('\n');
    case 'carousel':
      return [
        'FORMAT: carousel.',
        '- 3 to 10 segments, one slide each, ONE point per slide. Slide 1 hooks,',
        '  the final slide sums up plus a light call. Keep slide text tight.',
      ].join('\n');
    case 'story':
      return [
        'FORMAT: story.',
        '- Exactly 1 long-form body segment, plus a short non-null title that names',
        '  the piece. The body breathes: setup, turn, landing.',
      ].join('\n');
    case 'script':
      return [
        'FORMAT: script.',
        '- 3 to 6 segments, each a scene beat: a time/visual cue plus the spoken',
        '  line. Beat 1 is the hook in the first seconds.',
      ].join('\n');
  }
}

/**
 * Layer 2 builder — pins the angle (the SUBJECT of the post) plus any binding
 * author guidance. Extracted so the main composer stays under the complexity
 * cap. The free-text guidance is binding direction and is never persisted.
 */
function intentFraming(intent: PublisherIntent, guidance: string): string {
  const lines = [INTENT_GUIDE[intent]];
  if (guidance.trim().length > 0) {
    lines.push(`Extra direction from the author (treat as binding): ${guidance.trim()}`);
  }
  lines.push('Lead with this angle. The post is ABOUT this, not about the codebase.');
  return lines.join('\n');
}

/**
 * Build the content-generation instruction block for a headless `claude -p`
 * call. Pure function. Composes the prompt in weighted layers:
 * identity -> intent+guidance -> forbidden words -> general voice ->
 * (reddit guide) -> target -> format -> count -> grounding -> output contract.
 *
 * The intent+guidance layer sits directly under identity so the post's SUBJECT
 * (the angle) is pinned BEFORE any voice or grounding copy. This is the v3 fix:
 * v2 posts over-indexed on the stack/commits instead of the angle.
 *
 * The returned string is the full prompt. It instructs the model to emit ONLY
 * a JSON object describing N voice-driven variations grounded strictly in the
 * supplied git context.
 */
export function buildPublisherPrompt(input: {
  repoName: string;
  target: PublisherTarget;
  format: PostFormat;
  intent: PublisherIntent;
  guidance: string;
  count: number;
  authorVoice: string;
  recentCommits: string[];
  stats: string;
  readmeExcerpt: string;
}): string {
  const {
    repoName,
    target,
    format,
    intent,
    guidance,
    count,
    authorVoice,
    recentCommits,
    stats,
    readmeExcerpt,
  } = input;

  // Layer 1 — IDENTITY (highest weight, top of prompt).
  const voice =
    authorVoice.trim().length > 0 ? authorVoice.trim() : 'the engineer who wrote this code';
  const identity = [
    'Write as this author.',
    `Identity and voice: ${voice}.`,
    'Sound like this specific person, not a brand.',
  ].join('\n');

  // Layer 2 — INTENT + GUIDANCE. Pins the angle (the SUBJECT of the post)
  // directly under identity, above every voice/grounding instruction.
  const intentBlock = intentFraming(intent, guidance);

  // Layer 3 — forbidden words line (built from the array so it stays in sync).
  const forbiddenLine =
    `${FORBIDDEN_LINE_MARKER} ${FORBIDDEN_BUZZWORDS.join(', ')}. ` +
    'Also drop announcement phrases ("I\'d be happy to", "let me explain") and ' +
    'journey-language ("on this journey", "throughout this process").';

  // Layer 6 — COUNT.
  const n = Math.max(1, Math.floor(count));
  const countLine =
    `Produce exactly ${n} variation${n === 1 ? '' : 's'}. ` +
    'Each MUST use a different hook/angle; never reuse an opening line.';

  // Layer 7 — GROUNDING.
  const commitsBlock =
    recentCommits.length > 0
      ? recentCommits.map((c) => `- ${c}`).join('\n')
      : '(no recent commits supplied)';
  const readmeBlock =
    readmeExcerpt.trim().length > 0 ? readmeExcerpt.trim() : '(no README excerpt supplied)';
  const statsBlock = stats.trim().length > 0 ? stats.trim() : '(no stats supplied)';

  // Layer 8 — OUTPUT CONTRACT.
  const titleRule =
    target === 'reddit' || format === 'story'
      ? 'title is a short non-null string.'
      : 'title is null.';
  const outputContract = [
    'OUTPUT — read carefully:',
    'Emit ONLY a single JSON object of this exact shape and nothing else:',
    '{"variations":[{"title": string|null, "segments": [string]}]}',
    `- ${titleRule}`,
    '- segments is an array of strings; its length follows the FORMAT rules above.',
    `- The array holds exactly ${n} variation object${n === 1 ? '' : 's'}.`,
    '- NO prose before or after. NO markdown. NO code fence. JSON only.',
  ].join('\n');

  const layers = [identity, '', intentBlock, '', forbiddenLine, '', GENERAL_VOICE_GUIDE];

  if (target === 'reddit') {
    layers.push('', REDDIT_GUIDE);
  }

  layers.push(
    '',
    targetFraming(target),
    '',
    formatFraming(format),
    '',
    countLine,
    '',
    `GROUNDING — repository "${repoName}". The commits, stats, and README below are`,
    'SUPPORTING EVIDENCE for the angle, never the subject of the post. Do not lead',
    'with the stack, the languages, or the commit list. Use only the details that',
    'serve the angle and omit the rest. Do not invent features, metrics, users, or',
    'capabilities the context does not show. Thin evidence means a shorter, honest',
    'post, never a tech inventory.',
    '',
    'Recent commits:',
    commitsBlock,
    '',
    'Activity stats:',
    statsBlock,
    '',
    'README excerpt:',
    readmeBlock,
    '',
    outputContract,
  );

  return layers.join('\n');
}

/** Exported for tests and any caller that wants to validate generated output. */
export const PUBLISHER_FORBIDDEN_BUZZWORDS = FORBIDDEN_BUZZWORDS;
