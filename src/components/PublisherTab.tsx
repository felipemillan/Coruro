// PublisherTab — assisted-manual social Publisher.
//
// Flow (all assisted-manual, nothing automated):
//   1. Pick a repo + target (LinkedIn / Reddit).
//   2. "Generate draft" gathers READ-ONLY git context + README and generates the
//      post IN-APP via a headless `claude -p` call. The draft auto-fills the
//      editable body below — no terminal, no paste-back. When an output dir is
//      configured, share images are rendered LOCALLY (renderer-absent is
//      tolerated with a soft note).
//   3. "Copy draft" copies the body; "Open compose" opens the platform's real
//      compose page in the browser. The human pastes and clicks post.
//
// DAG: components -> stores -> utils -> types. This component reads useBoardStore
// (repos, settings, activity log) and usePublisherStore; it owns no business
// logic. Styling uses only the existing nb-* primitives — no new design language.

import { useEffect, useState } from 'react';
import { Megaphone, Copy, ExternalLink, Sparkles, Check } from 'lucide-react';
import { useBoardStore } from '../store/useBoardStore';
import { usePublisherStore, assetSrc } from '../store/usePublisherStore';
import type { PublisherAsset, PublisherTarget, Repo } from '../types';

const TARGETS: { id: PublisherTarget; label: string }[] = [
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'reddit', label: 'Reddit' },
];

const LABEL = 'text-[10px] font-semibold uppercase tracking-widest text-navy-light';

/** Repo picker + target toggle + Generate button. Presentational. */
function ComposeControls({
  repos,
  selectedPath,
  target,
  busy,
  canGenerate,
  onPickRepo,
  onSelectTarget,
  onGenerate,
}: {
  repos: Repo[];
  selectedPath: string;
  target: PublisherTarget;
  busy: boolean;
  canGenerate: boolean;
  onPickRepo: (path: string) => void;
  onSelectTarget: (t: PublisherTarget) => void;
  onGenerate: () => void;
}) {
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
        <span className={LABEL}>Target</span>
        <div className="flex items-center gap-2">
          {TARGETS.map((t) => {
            const active = target === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTarget(t.id)}
                className={[
                  'nb-chip text-[12px] px-3 py-1.5 font-medium transition-colors duration-150 cursor-pointer',
                  active ? 'bg-sage text-cream' : 'bg-cream text-navy-light hover:bg-warm-gray',
                ].join(' ')}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate || busy}
        className="nb-btn nb-hover self-start flex items-center gap-2 bg-navy text-cream px-4 py-2.5 text-[12px] font-semibold tracking-wide disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        <Sparkles size={14} strokeWidth={1.75} />
        {busy ? 'Working…' : 'Generate draft'}
      </button>

      <p className="text-[11px] text-navy-light/70 leading-relaxed">
        Generate builds a grounded draft in-app and fills the body below. Edit it, then copy and
        open the compose page.
      </p>
    </div>
  );
}

export function PublisherTab() {
  const repos = useBoardStore((s) => s.repos);
  const outputDir = useBoardStore((s) => s.settings.publisherOutputDir);
  const defaultTarget = useBoardStore((s) => s.settings.publisherDefaultTarget);
  const logActivity = useBoardStore((s) => s.logActivity);

  const draft = usePublisherStore((s) => s.draft);
  const note = usePublisherStore((s) => s.note);
  const setTarget = usePublisherStore((s) => s.setTarget);
  const setRepo = usePublisherStore((s) => s.setRepo);
  const setBody = usePublisherStore((s) => s.setBody);
  const generate = usePublisherStore((s) => s.generate);
  const copyDraft = usePublisherStore((s) => s.copyDraft);
  const openCompose = usePublisherStore((s) => s.openCompose);

  const [selectedPath, setSelectedPath] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Seed the target from the persisted default once, on first mount.
  useEffect(() => {
    setTarget(defaultTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRepo: Repo | undefined = repos.find((r) => r.path === selectedPath);
  const busy = draft.status === 'generating' || draft.status === 'rendering';

  const onPickRepo = (path: string) => {
    setSelectedPath(path);
    setRepo(repos.find((r) => r.path === path)?.name ?? '');
  };

  const onGenerate = async () => {
    if (!selectedRepo) return;
    await generate(selectedRepo, outputDir);
    logActivity({
      id: crypto.randomUUID(),
      ts: Date.now(),
      kind: 'publisher_draft_generated',
      repoName: selectedRepo.name,
      label: draft.target,
    });
  };

  const onCopy = async () => {
    await copyDraft();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
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
          busy={busy}
          canGenerate={selectedRepo !== undefined}
          onPickRepo={onPickRepo}
          onSelectTarget={setTarget}
          onGenerate={() => void onGenerate()}
        />

        {note !== null && (
          <div className="nb-card-sm bg-terracotta/12 border-terracotta/40 text-[11px] text-navy px-3 py-2 font-mono">
            {note}
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Draft body</span>
          <textarea
            value={draft.body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Generated draft appears here; edit before publishing…"
            spellCheck
            rows={10}
            className="nb-input bg-cream text-[13px] leading-relaxed text-navy px-3 py-2.5 font-mono resize-y"
          />
        </label>

        <AssetThumbs assets={draft.assets} />

        <ActionRow
          copied={copied}
          canCopy={draft.body.trim().length > 0}
          onCopy={() => void onCopy()}
          onOpenCompose={() => void onOpenCompose()}
        />
      </div>
    </div>
  );
}

/** Local thumbnails for rendered share images (file://-backed, no network). */
function AssetThumbs({ assets }: { assets: PublisherAsset[] }) {
  if (assets.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL}>Rendered images ({assets.length})</span>
      <div className="flex flex-wrap gap-3">
        {assets.map((a) => (
          <img
            key={a.absPath}
            src={assetSrc(a.absPath)}
            alt={a.kind}
            className="nb-card-sm w-28 h-28 object-cover bg-warm-gray"
          />
        ))}
      </div>
    </div>
  );
}

/** Copy + Open-compose action buttons. Presentational. */
function ActionRow({
  copied,
  canCopy,
  onCopy,
  onOpenCompose,
}: {
  copied: boolean;
  canCopy: boolean;
  onCopy: () => void;
  onOpenCompose: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 pt-1">
      <button
        type="button"
        onClick={onCopy}
        disabled={!canCopy}
        className="nb-btn nb-hover flex items-center gap-2 bg-cream text-navy px-4 py-2.5 text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        {copied ? <Check size={14} strokeWidth={1.75} /> : <Copy size={14} strokeWidth={1.75} />}
        {copied ? 'Copied' : 'Copy draft'}
      </button>
      <button
        type="button"
        onClick={onOpenCompose}
        className="nb-btn nb-hover flex items-center gap-2 bg-sage text-cream px-4 py-2.5 text-[12px] font-semibold cursor-pointer"
      >
        <ExternalLink size={14} strokeWidth={1.75} />
        Open compose
      </button>
    </div>
  );
}
