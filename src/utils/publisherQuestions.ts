// publisherQuestions.ts — pure static and AI-tailored guided questions for
// the Publisher Brief. No I/O, no filesystem reads at runtime.
//
// NOTE: The "Tailor with AI" path uses plan-billed `claude -p` via the
// `publisher_generate` Tauri command (same headless path as post generation),
// NOT the Apple FoundationModels sidecar. The P0 sidecar token cap does not
// apply here.

import type { PublisherIntent, PublisherRole, PublisherQuestion } from '../types';
import { PUBLISHER_DEV_ROLES } from '../types';

/**
 * Three baked questions per intent. Ids are stable across updates — they key
 * the answers in PublisherBrief.answers. Questions steer toward STORY not stack.
 */
export const STATIC_QUESTIONS: Record<PublisherIntent, PublisherQuestion[]> = {
  story: [
    { id: 'story-moment', prompt: 'What specific moment or event triggered this?' },
    { id: 'story-stakes', prompt: 'What was at risk or what would have broken without this?' },
    { id: 'story-turn', prompt: 'What surprised you or changed your mind along the way?' },
  ],
  lesson: [
    { id: 'lesson-mistake', prompt: 'What went wrong or what assumption did you start with?' },
    { id: 'lesson-turn', prompt: 'When did you realise something was off, and what changed?' },
    { id: 'lesson-takeaway', prompt: 'What is the one thing you want the reader to take away?' },
  ],
  launch: [
    { id: 'launch-problem', prompt: 'What problem does this solve, in one sentence?' },
    { id: 'launch-reader', prompt: 'Who will care most about this, and why now?' },
    { id: 'launch-detail', prompt: 'What one specific detail shows this works?' },
  ],
  behind_scenes: [
    {
      id: 'bts-messiest',
      prompt: 'What was the messiest or most surprising part of building this?',
    },
    { id: 'bts-decision', prompt: 'What trade-off or decision are you not sure about?' },
    { id: 'bts-reality', prompt: 'What does the day-to-day actually look like right now?' },
  ],
  deep_dive: [
    {
      id: 'dive-concept',
      prompt: 'What is the one concrete thing you want the reader to understand?',
    },
    { id: 'dive-wrong', prompt: 'What do most people get wrong about this topic?' },
    { id: 'dive-example', prompt: 'What is the most useful real example or number you can share?' },
  ],
  feedback: [
    { id: 'fb-question', prompt: 'What is the specific decision or doubt you want input on?' },
    { id: 'fb-tried', prompt: 'What have you already tried or considered?' },
    { id: 'fb-ideal', prompt: 'What would an ideal answer look like for you?' },
  ],
  milestone: [
    {
      id: 'ms-number',
      prompt: 'What is the milestone number or marker, and how long did it take?',
    },
    { id: 'ms-hardest', prompt: 'What was the hardest part of getting here?' },
    { id: 'ms-next', prompt: 'What changes now that you have hit this point?' },
  ],
  hot_take: [
    { id: 'ht-opinion', prompt: 'State your contrarian view in one plain sentence.' },
    { id: 'ht-evidence', prompt: 'What evidence or experience backs it up?' },
    { id: 'ht-disagree', prompt: 'Why do most people disagree, and where are they not wrong?' },
  ],
};

/** Role-specific supplemental questions, keyed by role id. */
const ROLE_EXTRA_QUESTIONS: Partial<Record<PublisherRole, PublisherQuestion>> = {
  'growth-marketer': {
    id: 'role-growth-angle',
    prompt: 'Who is the specific audience, and where will you distribute this post?',
  },
  cmo: {
    id: 'role-cmo-angle',
    prompt: 'What business or brand goal does this post serve?',
  },
};

/**
 * Return the base static questions for an intent, plus an optional role-hinted
 * question when the role set includes a non-dev role with a defined extra.
 * Pure — no I/O.
 */
export function staticQuestionsFor(
  intent: PublisherIntent,
  roles: PublisherRole[],
): PublisherQuestion[] {
  const base = STATIC_QUESTIONS[intent] ?? [];
  for (const role of roles) {
    if (!PUBLISHER_DEV_ROLES.has(role) && ROLE_EXTRA_QUESTIONS[role]) {
      return [...base, ROLE_EXTRA_QUESTIONS[role]!];
    }
  }
  return base;
}

/**
 * Build the prompt that asks claude to emit tailored guided questions.
 * Pure — no I/O. The prompt instructs the model to emit ONLY a JSON object.
 */
export function buildTailorQuestionsPrompt(input: {
  intent: PublisherIntent;
  roles: PublisherRole[];
  seniority: string;
  audience: string;
  repoName: string;
  authorVoice: string;
  recentCommits: string[];
}): string {
  const { intent, roles, seniority, audience, repoName, authorVoice, recentCommits } = input;
  const roleStr = roles.join(', ');
  const commitLines =
    recentCommits.length > 0
      ? recentCommits
          .slice(0, 8)
          .map((c) => `- ${c}`)
          .join('\n')
      : '(none)';
  const audienceStr = audience.trim().length > 0 ? audience.trim() : 'general technical audience';
  const voiceStr =
    authorVoice.trim().length > 0 ? authorVoice.trim() : 'a builder sharing their work';

  return [
    `You are helping a ${roleStr} (seniority: ${seniority}) write a social media post with the angle: ${intent}.`,
    `They write as: ${voiceStr}.`,
    `They are writing for: ${audienceStr}.`,
    `Repository context — "${repoName}" recent commits:`,
    commitLines,
    '',
    'Generate 3 to 4 guided questions that will help this specific author write a better post.',
    'Questions should be concrete, story-focused, and specific to their role and audience.',
    'Do NOT ask about tech stack, tools used, or implementation details.',
    'Do NOT use these words: thrilled, excited, leverage, seamless, robust, innovative.',
    '',
    'Emit ONLY valid JSON — no prose, no markdown fences:',
    '{"questions":[{"id":"kebab-case-id","prompt":"Question text?"}]}',
    'Exactly 3 to 4 items. ids must be unique kebab-case strings.',
  ].join('\n');
}

function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

function extractItems(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as Record<string, unknown>).questions)
  ) {
    return (parsed as Record<string, unknown>).questions as unknown[];
  }
  return null;
}

function coerceItem(item: unknown, index: number): PublisherQuestion | null {
  if (typeof item !== 'object' || item === null) return null;
  const obj = item as Record<string, unknown>;
  const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : '';
  if (!prompt) return null;
  const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : `q${index}`;
  return { id, prompt };
}

/**
 * Parse the raw string from publisher_generate into PublisherQuestion[].
 * Tolerant: strips JSON fences, accepts bare array or {questions:[...]} wrapper,
 * coerces each item, caps at 4. Never throws — returns [] on any failure.
 */
export function parseTailoredQuestions(raw: string): PublisherQuestion[] {
  try {
    const parsed: unknown = JSON.parse(stripJsonFences(raw));
    const items = extractItems(parsed);
    if (!items) return [];
    const result: PublisherQuestion[] = [];
    for (let i = 0; i < items.length && result.length < 4; i++) {
      const q = coerceItem(items[i], i);
      if (q) result.push(q);
    }
    return result;
  } catch {
    return [];
  }
}
