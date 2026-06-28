import type { PublisherTarget } from '../types';

// NOTE: This prompt targets a headless `claude -p` call (the `publisher_generate`
// Tauri command), the same plan-billed claude tier as the interactive PTY but
// run non-interactively. It is NOT bound by the 4096-token Apple
// FoundationModels sidecar budget — Coruro invariant 5 (the on-device sidecar
// token cap) does not apply to text generated here.

/**
 * Buzzwords the generated post must never contain. Kept lowercase; the
 * instruction tells the model to avoid them in any casing.
 */
const FORBIDDEN_BUZZWORDS: readonly string[] = [
  'thrilled',
  'excited',
  'delighted',
  'leverage',
  'seamless',
  'robust',
  'game-changing',
  'cutting-edge',
  'revolutionary',
  'passionate',
];

/** Per-target framing guidance. Pure data — no side effects. */
function targetFraming(target: PublisherTarget): string {
  switch (target) {
    case 'linkedin':
      return [
        'Platform: LinkedIn.',
        '- Write a short, professional post (roughly 3 to 6 tight sentences or a few short lines).',
        '- Plain, technical register. Speak to engineers, not marketers.',
        '- No hashtag spam (at most one or two if they are genuinely relevant).',
        '- Lead with what actually changed in the code, not with a hook or a humble-brag.',
      ].join('\n');
    case 'reddit':
      return [
        'Platform: Reddit (an r/-style technical writeup, e.g. r/programming or a language subreddit).',
        '- Write like a developer posting to peers: matter-of-fact, specific, no corporate tone.',
        '- It is fine to be longer than a LinkedIn post and to include concrete detail.',
        '- No marketing voice, no calls to action like "check it out!", no emoji-driven hype.',
        '- Title-then-body shape is welcome: a plain descriptive title, then the writeup.',
      ].join('\n');
  }
}

/**
 * Build a content-generation instruction block for an interactive `claude` PTY
 * session. Pure function: deterministic given its input, no I/O, no clock.
 *
 * The returned string is the full prompt to feed the model. It instructs the
 * model to write a platform-specific post grounded ONLY in the supplied git
 * context, in a straight-talking technical register with zero marketing
 * buzzwords.
 */
export function buildPublisherPrompt(input: {
  repoName: string;
  target: PublisherTarget;
  recentCommits: string[];
  stats: string;
  readmeExcerpt: string;
}): string {
  const { repoName, target, recentCommits, stats, readmeExcerpt } = input;

  const commitsBlock =
    recentCommits.length > 0
      ? recentCommits.map((c) => `- ${c}`).join('\n')
      : '(no recent commits supplied)';

  const readmeBlock =
    readmeExcerpt.trim().length > 0 ? readmeExcerpt.trim() : '(no README excerpt supplied)';

  const statsBlock = stats.trim().length > 0 ? stats.trim() : '(no stats supplied)';

  const forbiddenList = FORBIDDEN_BUZZWORDS.join(', ');

  return [
    `You are drafting a social post about recent development work on the repository "${repoName}".`,
    '',
    'Voice and constraints:',
    '- Straight-talking, technical register. Sound like the engineer who wrote the code.',
    `- ZERO marketing buzzwords. Do not use any of these words, in any casing: ${forbiddenList}.`,
    '- No hype, no superlatives, no exclamation-driven enthusiasm.',
    '- Ground every claim ONLY in the git context supplied below. Do NOT invent features,',
    '  metrics, users, or capabilities that are not evidenced by the commits, stats, or README.',
    '- If the supplied context is thin, write a shorter, honest post rather than padding it.',
    '',
    targetFraming(target),
    '',
    `Repository: ${repoName}`,
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
    'Output only the post body, ready to paste. No preamble, no explanation of your choices.',
  ].join('\n');
}

/** Exported for tests and any caller that wants to validate generated output. */
export const PUBLISHER_FORBIDDEN_BUZZWORDS = FORBIDDEN_BUZZWORDS;
