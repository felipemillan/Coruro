// PublisherTab — assisted-manual social Publisher (v4, brief + guided questions + repurpose).
//
// Flow (all assisted-manual, nothing automated):
//   1. Pick a repo + intent (angle) + optional guidance + network + format +
//      model + how many variations. Set your role, seniority, audience, and
//      optionally answer guided questions.
//   2. "Generate" gathers READ-ONLY git context + README and generates N
//      voice-driven variations IN-APP via a headless `claude -p` call. Output is
//      content-only — it can never touch a repo. No terminal, no paste-back.
//   3. Switch between variations, copy a single segment or the whole variation,
//      then "Open compose" opens the platform's real compose page in the browser.
//      The human pastes and clicks post.
//   4. Every ready generation is saved to the persisted Publisher history so the
//      user can reopen, re-copy, repurpose to another network, or delete a past draft.
//
// DAG: components -> stores -> utils -> types. This component reads useBoardStore
// (repos, settings, activity log, publisherHistory), usePublisherStore (runtime
// draft) and the publisher/repoStats utils; it owns no business logic. The
// history WRITE happens HERE (like the existing logActivity call), never inside
// usePublisherStore. Styling uses only the existing nb-* primitives.

import { useEffect, useState } from 'react';
import {
  Megaphone,
  Copy,
  ExternalLink,
  Sparkles,
  Check,
  History,
  ChevronDown,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useBoardStore } from '../store/useBoardStore';
import { usePublisherStore } from '../store/usePublisherStore';
import { VALID_FORMATS, segmentLabel, joinSegments } from '../utils/publisherFormats';
import { staticQuestionsFor } from '../utils/publisherQuestions';
import { relativeAge } from '../utils/repoStats';
import {
  PUBLISHER_AUDIENCES,
  PUBLISHER_INTENTS,
  PUBLISHER_MODELS,
  MAX_PUBLISHER_AUDIENCE_LEN,
  MAX_PUBLISHER_ANSWER_LEN,
  type PostFormat,
  type PublisherDraft,
  type PublisherHistoryEntry,
  type PublisherIntent,
  type PublisherModel,
  type PublisherQuestion,
  type PublisherTarget,
  type Repo,
} from '../types';

const TARGETS: { id: PublisherTarget; label: string }[] = [
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

// Networks whose compose page does NOT accept prefilled text — user must paste.
const NO_PREFILL: ReadonlySet<PublisherTarget> = new Set<PublisherTarget>([
  'instagram',
  'tiktok',
  'facebook',
]);

const LABEL = 'text-[10px] font-semibold uppercase tracking-widest text-navy-light';
const COUNTS: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5];

/**
 * Module-level monotonic counter appended to each history id so two generations
 * landing in the same millisecond (identical ISO timestamp) still get distinct
 * ids — deterministic, no Math.random / Date.now-in-render.
 */
let historyEntrySeq = 0;

/** Build a deterministic-id history entry from the current draft (no Math.random). */
function buildHistoryEntry(d: PublisherDraft): PublisherHistoryEntry {
  const generatedAt = new Date().toISOString();
  return {
    id: `${d.repoName}-${generatedAt}-${historyEntrySeq++}`,
    repoName: d.repoName,
    target: d.target,
    format: d.format,
    intent: d.intent,
    model: d.model,
    generatedAt,
    variations: d.variations,
    brief: {
      roles: d.roles,
      seniority: d.seniority,
      audience: d.audience,
      intent: d.intent,
      guidance: d.guidance,
      answers: d.answers,
      repoName: d.repoName,
    },
  };
}

/** Copy a saved entry's first variation (joined per format) to the clipboard. */
async function copyHistoryEntry(entry: PublisherHistoryEntry): Promise<void> {
  const variation = entry.variations[0];
  if (!variation) return;
  await navigator.clipboard.writeText(joinSegments(variation, entry.format));
}

/** Shared pill button used by the network / format / model / count / role / seniority selectors. */
function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'nb-chip text-[12px] px-3 py-1.5 font-medium transition-colors duration-150 cursor-pointer',
        active ? 'bg-sage text-cream' : 'bg-cream text-navy-light hover:bg-warm-gray',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/** Questions panel: one textarea per question + optional AI-tailor button. */
function GuidedQuestionsPanel({
  questions,
  answers,
  questionsStatus,
  onSetAnswer,
  onClearAnswers,
  onTailor,
}: {
  questions: PublisherQuestion[];
  answers: Record<string, string>;
  questionsStatus: 'idle' | 'tailoring' | 'error';
  onSetAnswer: (id: string, text: string) => void;
  onClearAnswers: () => void;
  onTailor: () => void;
}) {
  const hasAnswers = Object.values(answers).some((v) => v.trim().length > 0);
  const isTailoring = questionsStatus === 'tailoring';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className={LABEL}>Guided questions</span>
        <div className="flex items-center gap-2">
          {hasAnswers && (
            <button
              type="button"
              onClick={onClearAnswers}
              className="nb-chip text-[11px] px-2.5 py-1 font-medium bg-cream text-navy-light hover:bg-warm-gray cursor-pointer"
            >
              Clear answers
            </button>
          )}
          <button
            type="button"
            onClick={onTailor}
            disabled={isTailoring}
            className="nb-chip text-[11px] px-2.5 py-1 font-medium bg-cream text-navy hover:bg-warm-gray cursor-pointer disabled:opacity-40 flex items-center gap-1"
          >
            <Sparkles size={11} strokeWidth={1.75} />
            {isTailoring ? 'Tailoring…' : 'Tailor with AI'}
          </button>
        </div>
      </div>
      {questionsStatus === 'error' && (
        <div className="nb-card-sm bg-terracotta/12 border-terracotta/40 text-[11px] text-navy px-3 py-2">
          AI tailoring failed — using default questions.
        </div>
      )}
      <div className="flex flex-col gap-3">
        {questions.map((q) => (
          <label key={q.id} className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-navy-light">{q.prompt}</span>
            <textarea
              value={answers[q.id] ?? ''}
              onChange={(e) => onSetAnswer(q.id, e.target.value)}
              placeholder="Optional — leave blank to let the draft speak for itself."
              rows={2}
              maxLength={MAX_PUBLISHER_ANSWER_LEN}
              className="nb-input bg-cream text-[12px] leading-relaxed text-navy px-2.5 py-2 resize-y"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/** Network / format / model / count banner that does NOT prefill warning helper. */
function ComposeNotes({ note, target }: { note: string | null; target: PublisherTarget }) {
  return (
    <>
      {note !== null && (
        <div className="nb-card-sm bg-terracotta/12 border-terracotta/40 text-[11px] text-navy px-3 py-2 font-mono">
          {note}
        </div>
      )}
      {NO_PREFILL.has(target) && (
        <div className="nb-card-sm bg-warm-gray/50 text-[11px] text-navy-light px-3 py-2 leading-relaxed">
          Heads up: {TARGETS.find((t) => t.id === target)?.label}'s compose page does not prefill
          text. Copy the draft here, then paste it manually after the page opens.
        </div>
      )}
    </>
  );
}

/**
 * The full left-column control panel: repository, angle, audience, network +
 * format (2-up), model + variations (2-up), context (free-text guidance),
 * guided questions, and Generate. Reads audience/answers/questions directly
 * from usePublisherStore (like the panel it replaced); everything else comes
 * in as props from the tab hook (like the compose controls it replaced).
 */
function LeftControls({
  repos,
  selectedPath,
  selectedRepo,
  authorVoice,
  intent,
  guidance,
  target,
  format,
  model,
  count,
  busy,
  canGenerate,
  onPickRepo,
  onSelectIntent,
  onChangeGuidance,
  onSelectTarget,
  onSelectFormat,
  onSelectModel,
  onSelectCount,
  onGenerate,
}: {
  repos: Repo[];
  selectedPath: string;
  selectedRepo: Repo | undefined;
  authorVoice: string;
  intent: PublisherIntent;
  guidance: string;
  target: PublisherTarget;
  format: PostFormat;
  model: PublisherModel;
  count: number;
  busy: boolean;
  canGenerate: boolean;
  onPickRepo: (path: string) => void;
  onSelectIntent: (i: PublisherIntent) => void;
  onChangeGuidance: (g: string) => void;
  onSelectTarget: (t: PublisherTarget) => void;
  onSelectFormat: (f: PostFormat) => void;
  onSelectModel: (m: PublisherModel) => void;
  onSelectCount: (n: number) => void;
  onGenerate: () => void;
}) {
  const roles = usePublisherStore((s) => s.draft.roles);
  const audience = usePublisherStore((s) => s.draft.audience);
  const answers = usePublisherStore((s) => s.draft.answers);
  const questionsStatus = usePublisherStore((s) => s.draft.questionsStatus);
  const tailoredQuestions = usePublisherStore((s) => s.draft.tailoredQuestions);
  const setAudience = usePublisherStore((s) => s.setAudience);
  const setAnswer = usePublisherStore((s) => s.setAnswer);
  const clearAnswers = usePublisherStore((s) => s.clearAnswers);
  const tailorQuestions = usePublisherStore((s) => s.tailorQuestions);

  const questions = tailoredQuestions ?? staticQuestionsFor(intent, roles);
  const validFormats = VALID_FORMATS[target];

  const onTailor = async () => {
    if (!selectedRepo) return;
    await tailorQuestions(selectedRepo, { authorVoice });
  };

  return (
    <div className="nb-card bg-warm-gray/40 p-4 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Repository</span>
        <select
          value={selectedPath}
          onChange={(e) => onPickRepo(e.target.value)}
          className="nb-input bg-cream text-[13px] text-navy px-2.5 py-2 cursor-pointer"
        >
          <option value="">Select a repository…</option>
          {repos.map((r) => (
            <option key={r.path} value={r.path}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Angle</span>
        <select
          value={intent}
          onChange={(e) => onSelectIntent(e.target.value as PublisherIntent)}
          className="nb-input bg-cream text-[13px] text-navy px-2.5 py-2 cursor-pointer"
        >
          {PUBLISHER_INTENTS.map((i) => (
            <option key={i} value={i}>
              {INTENT_LABEL[i]}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Audience (optional)</span>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) setAudience(e.target.value);
          }}
          className="nb-input bg-cream text-[13px] text-navy px-2.5 py-2 cursor-pointer"
        >
          <option value="">Custom — type your own below…</option>
          {PUBLISHER_AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={audience}
          onChange={(e) => setAudience(e.target.value.slice(0, MAX_PUBLISHER_AUDIENCE_LEN))}
          placeholder="e.g. indie hackers building SaaS tools"
          maxLength={MAX_PUBLISHER_AUDIENCE_LEN}
          className="nb-input bg-cream text-[13px] text-navy px-2.5 py-2"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Network</span>
          <div className="flex flex-wrap items-center gap-2">
            {TARGETS.map((t) => (
              <Pill key={t.id} active={target === t.id} onClick={() => onSelectTarget(t.id)}>
                {t.label}
              </Pill>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Format</span>
          <div className="flex flex-wrap items-center gap-2">
            {validFormats.map((f) => (
              <Pill key={f} active={format === f} onClick={() => onSelectFormat(f)}>
                {FORMAT_LABEL[f]}
              </Pill>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Model</span>
          <div className="flex flex-wrap items-center gap-2">
            {PUBLISHER_MODELS.map((m) => (
              <Pill key={m} active={model === m} onClick={() => onSelectModel(m)}>
                {MODEL_LABEL[m]}
              </Pill>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Variations</span>
          <div className="flex items-center gap-2">
            {COUNTS.map((n) => (
              <Pill key={n} active={count === n} onClick={() => onSelectCount(n)}>
                {n}
              </Pill>
            ))}
          </div>
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Context (optional)</span>
        <textarea
          value={guidance}
          onChange={(e) => onChangeGuidance(e.target.value)}
          placeholder="Optional: extra context or angle, e.g. frame it around the 3am bug that started this."
          spellCheck
          rows={3}
          maxLength={MAX_PUBLISHER_ANSWER_LEN}
          className="nb-input bg-cream text-[12px] leading-relaxed text-navy px-2.5 py-2 resize-y"
        />
      </label>

      <GuidedQuestionsPanel
        questions={questions}
        answers={answers}
        questionsStatus={questionsStatus}
        onSetAnswer={setAnswer}
        onClearAnswers={clearAnswers}
        onTailor={() => void onTailor()}
      />

      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate || busy}
        className="nb-btn nb-hover self-start flex items-center gap-2 bg-navy text-cream px-4 py-2.5 text-[12px] font-semibold tracking-wide disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        <Sparkles size={14} strokeWidth={1.75} />
        {busy ? 'Working…' : 'Generate'}
      </button>

      <p className="text-[11px] text-navy-light/70 leading-relaxed">
        Drafts generate in-app from read-only git context — content only, never touching the repo.
        Pick a variation, copy it, then open the compose page.
      </p>
    </div>
  );
}

/** Tabs to switch between the generated variations. */
function VariationTabs({
  count,
  selected,
  titles,
  onSelect,
}: {
  count: number;
  selected: number;
  titles: (string | null)[];
  onSelect: (index: number) => void;
}) {
  if (count <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(i)}
          className={[
            'nb-chip text-[12px] px-3 py-1.5 font-medium transition-colors duration-150 cursor-pointer',
            i === selected ? 'bg-navy text-cream' : 'bg-cream text-navy-light hover:bg-warm-gray',
          ].join(' ')}
        >
          {titles[i]?.trim() ? titles[i] : `Variation ${i + 1}`}
        </button>
      ))}
    </div>
  );
}

/** One copy button with a transient "Copied" confirmation. */
function CopyButton({
  copied,
  disabled,
  label,
  onCopy,
  tone = 'cream',
}: {
  copied: boolean;
  disabled?: boolean;
  label: string;
  onCopy: () => void;
  tone?: 'cream' | 'sage';
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={disabled}
      className={[
        'nb-btn nb-hover flex items-center gap-2 px-3 py-2 text-[12px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
        tone === 'sage' ? 'bg-sage text-cream' : 'bg-cream text-navy',
      ].join(' ')}
    >
      {copied ? <Check size={14} strokeWidth={1.75} /> : <Copy size={14} strokeWidth={1.75} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

/** The generated-draft panel: variation tabs + segment cards + compose row. */
function DraftView({
  draft,
  copiedKey,
  onSelectVariation,
  onCopyAll,
  onCopySegment,
  onOpenCompose,
}: {
  draft: PublisherDraft;
  copiedKey: string | null;
  onSelectVariation: (index: number) => void;
  onCopyAll: () => void;
  onCopySegment: (index: number) => void;
  onOpenCompose: () => void;
}) {
  const selected = draft.variations[draft.selectedVariation];
  const titles = draft.variations.map((v) => v.title);
  if (!selected) {
    return (
      <p className="text-[12px] text-navy-light/70 italic px-1">
        No draft yet — pick a repository and generate to see variations here.
      </p>
    );
  }
  const isSingleBody = draft.format === 'single' || draft.format === 'story';
  const copyAll = (
    <div className="flex justify-end">
      <CopyButton copied={copiedKey === 'all'} label="Copy all" onCopy={onCopyAll} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <VariationTabs
        count={draft.variations.length}
        selected={draft.selectedVariation}
        titles={titles}
        onSelect={onSelectVariation}
      />

      {isSingleBody ? (
        <div className="nb-card bg-cream p-4 flex flex-col gap-2">
          {draft.format === 'story' && selected.title && (
            <span className="text-[13px] font-bold text-navy">{selected.title}</span>
          )}
          <textarea
            value={selected.segments[0]?.text ?? ''}
            readOnly
            spellCheck
            rows={10}
            className="nb-input bg-cream text-[13px] leading-relaxed text-navy px-3 py-2.5 font-mono resize-y"
          />
          {copyAll}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {selected.segments.map((seg, i) => (
            <div key={i} className="nb-card bg-cream p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className={LABEL}>
                  {segmentLabel(draft.format, i, selected.segments.length)}
                </span>
                <CopyButton
                  copied={copiedKey === `seg-${i}`}
                  label="Copy"
                  onCopy={() => onCopySegment(i)}
                />
              </div>
              <p className="text-[13px] leading-relaxed text-navy font-mono whitespace-pre-wrap">
                {seg.text}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        {!isSingleBody && copyAll}
        <button
          type="button"
          onClick={onOpenCompose}
          className="nb-btn nb-hover flex items-center gap-2 bg-sage text-cream px-4 py-2.5 text-[12px] font-semibold cursor-pointer"
        >
          <ExternalLink size={14} strokeWidth={1.75} />
          Open compose
        </button>
      </div>
    </div>
  );
}

/** One saved-history row: meta line + Open / Repurpose / Copy / Delete actions. */
function HistoryRow({
  entry,
  copied,
  onOpen,
  onCopy,
  onDelete,
  onRepurpose,
}: {
  entry: PublisherHistoryEntry;
  copied: boolean;
  onOpen: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onRepurpose?: () => void;
}) {
  const age = relativeAge(entry.generatedAt) || 'just now';
  const meta = [
    entry.repoName,
    TARGETS.find((t) => t.id === entry.target)?.label ?? entry.target,
    INTENT_LABEL[entry.intent],
    MODEL_LABEL[entry.model],
    age,
  ].join(' · ');
  return (
    <div className="nb-card-sm bg-cream px-3 py-2.5 flex items-center justify-between gap-2">
      <span className="text-[11px] text-navy font-mono truncate" title={meta}>
        {meta}
      </span>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onOpen}
          className="nb-chip text-[11px] px-2.5 py-1 font-medium bg-cream text-navy-light hover:bg-warm-gray cursor-pointer"
        >
          Open
        </button>
        {onRepurpose && (
          <button
            type="button"
            onClick={onRepurpose}
            className="nb-chip text-[11px] px-2.5 py-1 font-medium bg-cream text-navy-light hover:bg-warm-gray cursor-pointer"
          >
            Repurpose
          </button>
        )}
        <button
          type="button"
          onClick={onCopy}
          className="nb-chip text-[11px] px-2.5 py-1 font-medium bg-cream text-navy-light hover:bg-warm-gray cursor-pointer flex items-center gap-1"
        >
          {copied ? <Check size={12} strokeWidth={1.75} /> : <Copy size={12} strokeWidth={1.75} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete saved draft"
          className="nb-chip text-[11px] px-2 py-1 font-medium bg-cream text-terracotta hover:bg-warm-gray cursor-pointer"
        >
          <Trash2 size={12} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

/** Collapsible panel listing persisted Publisher history newest-first. */
function HistoryPanel({
  entries,
  onOpen,
  onCopy,
  onDelete,
  onClear,
  onRepurpose,
}: {
  entries: PublisherHistoryEntry[];
  onOpen: (entry: PublisherHistoryEntry) => void;
  onCopy: (entry: PublisherHistoryEntry) => Promise<void>;
  onDelete: (id: string) => void;
  onClear: () => void;
  onRepurpose: (entry: PublisherHistoryEntry) => void;
}) {
  const [open, setOpen] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [undo, setUndo] = useState<PublisherHistoryEntry | null>(null);
  const ordered = [...entries].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));

  const handleCopy = async (entry: PublisherHistoryEntry) => {
    await onCopy(entry);
    setCopiedId(entry.id);
    window.setTimeout(() => setCopiedId((k) => (k === entry.id ? null : k)), 1500);
  };

  const handleDelete = (entry: PublisherHistoryEntry) => {
    onDelete(entry.id);
    setUndo(entry);
    window.setTimeout(() => setUndo((u) => (u?.id === entry.id ? null : u)), 5000);
  };

  return (
    <div className="nb-card bg-warm-gray/40 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 cursor-pointer"
        >
          <History size={15} strokeWidth={1.75} className="text-navy" />
          <span className="text-[12px] font-bold tracking-wide text-navy">Saved drafts</span>
          <span className="text-[11px] text-navy-light/70 font-mono">{entries.length}</span>
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            className={['text-navy-light transition-transform', open ? '' : '-rotate-90'].join(' ')}
          />
        </button>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="nb-chip text-[11px] px-2.5 py-1 font-medium bg-cream text-navy-light hover:bg-warm-gray cursor-pointer flex items-center gap-1"
          >
            <Trash2 size={12} strokeWidth={1.75} />
            Clear all
          </button>
        )}
      </div>

      {undo && (
        <div className="nb-card-sm bg-cream px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-navy-light">Draft deleted.</span>
          <button
            type="button"
            onClick={() => {
              onOpen(undo);
              setUndo(null);
            }}
            className="nb-chip text-[11px] px-2.5 py-1 font-medium bg-cream text-navy hover:bg-warm-gray cursor-pointer flex items-center gap-1"
          >
            <Undo2 size={12} strokeWidth={1.75} />
            Reopen
          </button>
        </div>
      )}

      {open &&
        (ordered.length === 0 ? (
          <p className="text-[11px] text-navy-light/70 italic px-1">
            No saved drafts yet — generate one and it lands here.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {ordered.map((entry) => (
              <HistoryRow
                key={entry.id}
                entry={entry}
                copied={copiedId === entry.id}
                onOpen={() => onOpen(entry)}
                onCopy={() => void handleCopy(entry)}
                onDelete={() => handleDelete(entry)}
                onRepurpose={() => onRepurpose(entry)}
              />
            ))}
          </div>
        ))}
    </div>
  );
}

/** Publisher tab header — title + provenance line. */
function PublisherHeader() {
  return (
    <div className="flex items-center gap-2.5">
      <Megaphone size={18} strokeWidth={1.75} className="text-navy" />
      <h1 className="text-[15px] font-bold tracking-wide text-navy">Publisher</h1>
      <span className="text-[11px] text-navy-light/70 font-mono">
        assisted-manual · on-device draft
      </span>
    </div>
  );
}

/**
 * Resolve the entry's repoName slug against the current repo list and update
 * the component's selectedPath + historyNote accordingly.
 */
function resolveHistoryRepo(
  entry: PublisherHistoryEntry,
  repos: Repo[],
  setSelectedPath: (p: string) => void,
  setHistoryNote: (n: string | null) => void,
) {
  const match = repos.find((r) => r.name === entry.repoName);
  if (match) {
    setSelectedPath(match.path);
    setHistoryNote(null);
  } else {
    setHistoryNote(
      `"${entry.repoName}" isn't in the current repo list — pick a repository to re-generate.`,
    );
  }
}

/**
 * All store wiring + imperative handlers for the tab. Kept as a local hook so the
 * PublisherTab component itself stays declarative markup. The history WRITE lives
 * here (component layer), never inside usePublisherStore — same boundary the
 * existing logActivity call respects.
 */
function usePublisherTab() {
  const repos = useBoardStore((s) => s.repos);
  const defaultTarget = useBoardStore((s) => s.settings.publisherDefaultTarget);
  const defaultFormat = useBoardStore((s) => s.settings.publisherDefaultFormat);
  const defaultIntent = useBoardStore((s) => s.settings.publisherDefaultIntent);
  const defaultModel = useBoardStore((s) => s.settings.publisherDefaultModel);
  const authorVoice = useBoardStore((s) => s.settings.publisherAuthorVoice);
  const logActivity = useBoardStore((s) => s.logActivity);
  const historyEntries = useBoardStore((s) => s.publisherHistory.entries);
  const deletePublisherHistoryEntry = useBoardStore((s) => s.deletePublisherHistoryEntry);
  const clearPublisherHistory = useBoardStore((s) => s.clearPublisherHistory);

  const draft = usePublisherStore((s) => s.draft);
  const note = usePublisherStore((s) => s.note);
  const setTarget = usePublisherStore((s) => s.setTarget);
  const setFormat = usePublisherStore((s) => s.setFormat);
  const setIntent = usePublisherStore((s) => s.setIntent);
  const setGuidance = usePublisherStore((s) => s.setGuidance);
  const setModel = usePublisherStore((s) => s.setModel);
  const setCount = usePublisherStore((s) => s.setCount);
  const setRepo = usePublisherStore((s) => s.setRepo);
  const selectVariation = usePublisherStore((s) => s.selectVariation);
  const generate = usePublisherStore((s) => s.generate);
  const copyVariation = usePublisherStore((s) => s.copyVariation);
  const copySegment = usePublisherStore((s) => s.copySegment);
  const openCompose = usePublisherStore((s) => s.openCompose);
  const loadFromHistory = usePublisherStore((s) => s.loadFromHistory);

  const [selectedPath, setSelectedPath] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // Soft inline note shown when an opened history entry's repo isn't in the
  // current scan, so the user knows a fresh repo pick is needed to re-generate.
  const [historyNote, setHistoryNote] = useState<string | null>(null);

  // Seed angle + model + network + format + brief defaults once, on mount.
  useEffect(() => {
    setIntent(defaultIntent);
    setModel(defaultModel);
    setTarget(defaultTarget);
    if (VALID_FORMATS[defaultTarget].includes(defaultFormat)) setFormat(defaultFormat);
    const ps = useBoardStore.getState().settings;
    usePublisherStore.getState().setRoles(ps.publisherDefaultRoles);
    usePublisherStore.getState().setSeniority(ps.publisherDefaultSeniority);
    if (ps.publisherDefaultAudience)
      usePublisherStore.getState().setAudience(ps.publisherDefaultAudience);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRepo = repos.find((r) => r.path === selectedPath);

  const flash = (key: string) => {
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  };

  const onPickRepo = (path: string) => {
    setSelectedPath(path);
    setRepo(repos.find((r) => r.path === path)?.name ?? '');
    setHistoryNote(null);
  };

  // Open a saved draft: repopulate the runtime draft AND re-sync the component's
  // repo selection so canGenerate / Generate aren't left stale.
  const onOpenHistory = (entry: PublisherHistoryEntry) => {
    loadFromHistory(entry, 'view');
    resolveHistoryRepo(entry, repos, setSelectedPath, setHistoryNote);
  };

  const onGenerate = async () => {
    if (!selectedRepo) return;
    await generate(selectedRepo, { authorVoice });
    logActivity({
      id: crypto.randomUUID(),
      ts: Date.now(),
      kind: 'publisher_draft_generated',
      repoName: selectedRepo.name,
      label: draft.target,
    });
    // Read the fresh draft post-generate and only persist a successful run.
    const d = usePublisherStore.getState().draft;
    if (d.status === 'ready') {
      useBoardStore.getState().addPublisherHistoryEntry(buildHistoryEntry(d));
    }
  };

  const onOpenCompose = async () => {
    await openCompose();
    logActivity({
      id: crypto.randomUUID(),
      ts: Date.now(),
      kind: 'publisher_published',
      repoName: draft.repoName || (selectedRepo?.name ?? null),
      label: draft.target,
    });
  };

  return {
    repos,
    draft,
    note,
    selectedPath,
    selectedRepo,
    authorVoice,
    copiedKey,
    busy: draft.status === 'generating',
    canGenerate: selectedRepo !== undefined,
    historyEntries,
    setIntent,
    setGuidance,
    setTarget,
    setFormat,
    setModel,
    setCount,
    selectVariation,
    onOpenHistory,
    historyNote,
    deletePublisherHistoryEntry,
    clearPublisherHistory,
    onPickRepo,
    onGenerate,
    onOpenCompose,
    onRepurpose: (entry: PublisherHistoryEntry) => {
      loadFromHistory(entry, 'repurpose');
      resolveHistoryRepo(entry, repos, setSelectedPath, setHistoryNote);
    },
    onCopyAll: async () => {
      await copyVariation();
      flash('all');
    },
    onCopySegment: async (index: number) => {
      await copySegment(index);
      flash(`seg-${index}`);
    },
  };
}

/**
 * Left column — the full control panel (repository, angle, audience,
 * network/format, model/variations, context, guided questions, Generate).
 * Fixed 1/3 width, flush against the container's left edge (no page-level
 * centering above this — see PublisherTab's outer wrapper).
 */
function PublisherSidebar({ tab }: { tab: ReturnType<typeof usePublisherTab> }) {
  return (
    <aside className="lg:col-span-1 flex flex-col gap-4 lg:sticky lg:top-0 lg:self-start lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto lg:pr-1">
      <LeftControls
        repos={tab.repos}
        selectedPath={tab.selectedPath}
        selectedRepo={tab.selectedRepo}
        authorVoice={tab.authorVoice}
        intent={tab.draft.intent}
        guidance={tab.draft.guidance}
        target={tab.draft.target}
        format={tab.draft.format}
        model={tab.draft.model}
        count={tab.draft.count}
        busy={tab.busy}
        canGenerate={tab.canGenerate}
        onPickRepo={tab.onPickRepo}
        onSelectIntent={tab.setIntent}
        onChangeGuidance={tab.setGuidance}
        onSelectTarget={tab.setTarget}
        onSelectFormat={tab.setFormat}
        onSelectModel={tab.setModel}
        onSelectCount={tab.setCount}
        onGenerate={() => void tab.onGenerate()}
      />
    </aside>
  );
}

/** Right column — draft output only: compose notes + generated variations text box. Fills the rest of the viewport width. */
function PublisherEditor({ tab }: { tab: ReturnType<typeof usePublisherTab> }) {
  return (
    <section className="lg:col-span-2 flex flex-col gap-4">
      <ComposeNotes note={tab.note} target={tab.draft.target} />

      {tab.historyNote !== null && (
        <div className="nb-card-sm bg-warm-gray/50 text-[11px] text-navy-light px-3 py-2 leading-relaxed">
          {tab.historyNote}
        </div>
      )}

      <DraftView
        draft={tab.draft}
        copiedKey={tab.copiedKey}
        onSelectVariation={tab.selectVariation}
        onCopyAll={() => void tab.onCopyAll()}
        onCopySegment={(i) => void tab.onCopySegment(i)}
        onOpenCompose={() => void tab.onOpenCompose()}
      />
    </section>
  );
}

export function PublisherTab() {
  const tab = usePublisherTab();
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto bg-cream">
      <div className="w-full px-6 py-6 flex flex-col gap-5">
        <PublisherHeader />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          <PublisherSidebar tab={tab} />
          <PublisherEditor tab={tab} />
        </div>

        <HistoryPanel
          entries={tab.historyEntries}
          onOpen={tab.onOpenHistory}
          onCopy={copyHistoryEntry}
          onDelete={tab.deletePublisherHistoryEntry}
          onClear={tab.clearPublisherHistory}
          onRepurpose={tab.onRepurpose}
        />
      </div>
    </div>
  );
}
