// PublisherTab — assisted-manual social Publisher (v2, multi-variation).
//
// Flow (all assisted-manual, nothing automated):
//   1. Pick a repo + target network + post format + how many variations.
//   2. "Generate" gathers READ-ONLY git context + README and generates N
//      voice-driven variations IN-APP via a headless `claude -p` call. Output is
//      content-only — it can never touch a repo. No terminal, no paste-back.
//   3. Switch between variations, copy a single segment or the whole variation,
//      then "Open compose" opens the platform's real compose page in the browser.
//      The human pastes and clicks post.
//
// DAG: components -> stores -> utils -> types. This component reads useBoardStore
// (repos, settings, activity log), usePublisherStore (runtime draft) and the
// publisherFormats util; it owns no business logic. Styling uses only the
// existing nb-* primitives — no new design language.

import { useEffect, useState } from 'react';
import { Megaphone, Copy, ExternalLink, Sparkles, Check } from 'lucide-react';
import { useBoardStore } from '../store/useBoardStore';
import { usePublisherStore } from '../store/usePublisherStore';
import { VALID_FORMATS, segmentLabel } from '../utils/publisherFormats';
import type { PostFormat, PublisherDraft, PublisherTarget, Repo } from '../types';

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

// Networks whose compose page does NOT accept prefilled text — user must paste.
const NO_PREFILL: ReadonlySet<PublisherTarget> = new Set<PublisherTarget>([
  'instagram',
  'tiktok',
  'facebook',
]);

const LABEL = 'text-[10px] font-semibold uppercase tracking-widest text-navy-light';
const COUNTS: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5];

/** Shared pill button used by the network / format / count selectors. */
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

/** Repo picker + network / format / count selectors + Generate button. */
function ComposeControls({
  repos,
  selectedPath,
  target,
  format,
  count,
  busy,
  canGenerate,
  onPickRepo,
  onSelectTarget,
  onSelectFormat,
  onSelectCount,
  onGenerate,
}: {
  repos: Repo[];
  selectedPath: string;
  target: PublisherTarget;
  format: PostFormat;
  count: number;
  busy: boolean;
  canGenerate: boolean;
  onPickRepo: (path: string) => void;
  onSelectTarget: (t: PublisherTarget) => void;
  onSelectFormat: (f: PostFormat) => void;
  onSelectCount: (n: number) => void;
  onGenerate: () => void;
}) {
  const validFormats = VALID_FORMATS[target];
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
          {copyAll}
        </div>
      )}

      <div className="flex items-center gap-2.5 pt-1">
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

export function PublisherTab() {
  const repos = useBoardStore((s) => s.repos);
  const defaultTarget = useBoardStore((s) => s.settings.publisherDefaultTarget);
  const defaultFormat = useBoardStore((s) => s.settings.publisherDefaultFormat);
  const authorVoice = useBoardStore((s) => s.settings.publisherAuthorVoice);
  const logActivity = useBoardStore((s) => s.logActivity);

  const draft = usePublisherStore((s) => s.draft);
  const note = usePublisherStore((s) => s.note);
  const setTarget = usePublisherStore((s) => s.setTarget);
  const setFormat = usePublisherStore((s) => s.setFormat);
  const setCount = usePublisherStore((s) => s.setCount);
  const setRepo = usePublisherStore((s) => s.setRepo);
  const selectVariation = usePublisherStore((s) => s.selectVariation);
  const generate = usePublisherStore((s) => s.generate);
  const copyVariation = usePublisherStore((s) => s.copyVariation);
  const copySegment = usePublisherStore((s) => s.copySegment);
  const openCompose = usePublisherStore((s) => s.openCompose);

  const [selectedPath, setSelectedPath] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Seed network + format from the persisted defaults once, on first mount.
  useEffect(() => {
    setTarget(defaultTarget);
    if (VALID_FORMATS[defaultTarget].includes(defaultFormat)) {
      setFormat(defaultFormat);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRepo: Repo | undefined = repos.find((r) => r.path === selectedPath);
  const busy = draft.status === 'generating';

  const flash = (key: string) => {
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  };

  const onPickRepo = (path: string) => {
    setSelectedPath(path);
    setRepo(repos.find((r) => r.path === path)?.name ?? '');
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
  };

  const onCopyAll = async () => {
    await copyVariation();
    flash('all');
  };

  const onCopySegment = async (index: number) => {
    await copySegment(index);
    flash(`seg-${index}`);
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

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto bg-cream">
      <div className="mx-auto w-full max-w-3xl px-6 py-6 flex flex-col gap-5">
        <div className="flex items-center gap-2.5">
          <Megaphone size={18} strokeWidth={1.75} className="text-navy" />
          <h1 className="text-[15px] font-bold tracking-wide text-navy">Publisher</h1>
          <span className="text-[11px] text-navy-light/70 font-mono">
            assisted-manual · on-device draft
          </span>
        </div>

        <ComposeControls
          repos={repos}
          selectedPath={selectedPath}
          target={draft.target}
          format={draft.format}
          count={draft.count}
          busy={busy}
          canGenerate={selectedRepo !== undefined}
          onPickRepo={onPickRepo}
          onSelectTarget={setTarget}
          onSelectFormat={setFormat}
          onSelectCount={setCount}
          onGenerate={() => void onGenerate()}
        />

        {note !== null && (
          <div className="nb-card-sm bg-terracotta/12 border-terracotta/40 text-[11px] text-navy px-3 py-2 font-mono">
            {note}
          </div>
        )}

        {NO_PREFILL.has(draft.target) && (
          <div className="nb-card-sm bg-warm-gray/50 text-[11px] text-navy-light px-3 py-2 leading-relaxed">
            Heads up: {TARGETS.find((t) => t.id === draft.target)?.label}'s compose page does not
            prefill text. Copy the draft here, then paste it manually after the page opens.
          </div>
        )}

        <DraftView
          draft={draft}
          copiedKey={copiedKey}
          onSelectVariation={selectVariation}
          onCopyAll={() => void onCopyAll()}
          onCopySegment={(i) => void onCopySegment(i)}
          onOpenCompose={() => void onOpenCompose()}
        />
      </div>
    </div>
  );
}
