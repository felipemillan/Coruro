// Publisher section for the Settings modal.
// Owns the author-voice guidance, the default network selector, and the
// default-format selector (constrained to the chosen network's valid formats).
// All three persist via the settings slice. No filesystem paths here.

import { useBoardStore } from '../../store/useBoardStore';
import { VALID_FORMATS } from '../../utils/publisherFormats';
import {
  PUBLISHER_INTENTS,
  PUBLISHER_MODELS,
  type PostFormat,
  type PublisherIntent,
  type PublisherModel,
  type PublisherTarget,
} from '../../types';
import { SectionHeading } from './SectionHeading';

const TARGET_OPTIONS: { id: PublisherTarget; label: string }[] = [
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'x', label: 'X' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'reddit', label: 'Reddit' },
];

const FORMAT_LABEL: Record<PostFormat, string> = {
  single: 'Single',
  thread: 'Thread',
  carousel: 'Carousel',
  story: 'Story',
  script: 'Script',
};

const INTENT_LABEL: Record<PublisherIntent, string> = {
  story: 'Story',
  lesson: 'Lesson learned',
  launch: 'Launch',
  behind_scenes: 'Behind the scenes',
  deep_dive: 'Technical deep-dive',
  feedback: 'Ask for feedback',
  milestone: 'Milestone',
  hot_take: 'Hot take',
};

const MODEL_LABEL: Record<PublisherModel, string> = {
  'claude-opus-4-8': 'Opus',
  'claude-sonnet-4-6': 'Sonnet',
  'claude-haiku-4-5': 'Haiku',
};

export function PublisherSection() {
  const authorVoice = useBoardStore((s) => s.settings.publisherAuthorVoice);
  const defaultTarget = useBoardStore((s) => s.settings.publisherDefaultTarget);
  const defaultFormat = useBoardStore((s) => s.settings.publisherDefaultFormat);
  const defaultIntent = useBoardStore((s) => s.settings.publisherDefaultIntent);
  const defaultModel = useBoardStore((s) => s.settings.publisherDefaultModel);
  const setPublisherAuthorVoice = useBoardStore((s) => s.setPublisherAuthorVoice);
  const setPublisherDefaultTarget = useBoardStore((s) => s.setPublisherDefaultTarget);
  const setPublisherDefaultFormat = useBoardStore((s) => s.setPublisherDefaultFormat);
  const setPublisherDefaultIntent = useBoardStore((s) => s.setPublisherDefaultIntent);
  const setPublisherDefaultModel = useBoardStore((s) => s.setPublisherDefaultModel);

  const validFormats = VALID_FORMATS[defaultTarget];

  const onPickTarget = (next: PublisherTarget) => {
    void setPublisherDefaultTarget(next);
    // Keep the default format valid for the newly chosen network.
    if (!VALID_FORMATS[next].includes(defaultFormat)) {
      void setPublisherDefaultFormat(VALID_FORMATS[next][0]);
    }
  };

  return (
    <section>
      <SectionHeading>Publisher</SectionHeading>
      <p className="text-[12px] text-navy-light mb-3 leading-relaxed">
        Drafts generate in-app from read-only git context. These defaults shape every draft.
      </p>

      <label className="block text-[11px] text-navy-light mb-1">
        Author voice — who you are + tone. This is what makes posts sound like you.
      </label>
      <textarea
        value={authorVoice}
        onChange={(e) => void setPublisherAuthorVoice(e.target.value)}
        placeholder="e.g. Solo builder shipping a Tauri app. Plain, direct, a little dry. No hype, no emojis."
        spellCheck
        rows={5}
        className="nb-input w-full px-3 py-2 text-[12px] leading-relaxed text-navy resize-y"
      />

      <label className="block text-[11px] text-navy-light mt-4 mb-1">Default angle</label>
      <select
        value={defaultIntent}
        onChange={(e) => void setPublisherDefaultIntent(e.target.value as PublisherIntent)}
        className="nb-input w-full px-3 py-2 text-[12px] text-navy transition-colors duration-150 cursor-pointer"
      >
        {PUBLISHER_INTENTS.map((i) => (
          <option key={i} value={i}>
            {INTENT_LABEL[i]}
          </option>
        ))}
      </select>

      <label className="block text-[11px] text-navy-light mt-4 mb-1">Default model</label>
      <select
        value={defaultModel}
        onChange={(e) => void setPublisherDefaultModel(e.target.value as PublisherModel)}
        className="nb-input w-full px-3 py-2 text-[12px] text-navy transition-colors duration-150 cursor-pointer"
      >
        {PUBLISHER_MODELS.map((m) => (
          <option key={m} value={m}>
            {MODEL_LABEL[m]}
          </option>
        ))}
      </select>

      <label className="block text-[11px] text-navy-light mt-4 mb-1">Default network</label>
      <select
        value={defaultTarget}
        onChange={(e) => onPickTarget(e.target.value as PublisherTarget)}
        className="nb-input w-full px-3 py-2 text-[12px] text-navy transition-colors duration-150 cursor-pointer"
      >
        {TARGET_OPTIONS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      <label className="block text-[11px] text-navy-light mt-4 mb-1">Default format</label>
      <select
        value={defaultFormat}
        onChange={(e) => void setPublisherDefaultFormat(e.target.value as PostFormat)}
        className="nb-input w-full px-3 py-2 text-[12px] text-navy transition-colors duration-150 cursor-pointer"
      >
        {validFormats.map((f) => (
          <option key={f} value={f}>
            {FORMAT_LABEL[f]}
          </option>
        ))}
      </select>
    </section>
  );
}
