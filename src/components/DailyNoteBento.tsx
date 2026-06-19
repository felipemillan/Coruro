// Bento-grid renderer for a parsed "Daily Session Summary" note.
//
// Replaces the flat markdown list with a responsive Neo-Brutalist grid: thick
// navy borders, hard offset shadows, tier-tinted status cards. Palette is
// inferred from the design reference and mapped onto the app's existing tokens
// (cream surface, navy ink, sage/green + terracotta/red accents). Purely
// presentational — all data comes pre-structured from `parseDailyNote`.

import type { DailyNoteData, DailyRepoLine, DailyTier } from '../utils/parseDailyNote';
import { deriveNotables } from '../utils/parseDailyNote';
import type { DayNote } from '../types';

/** Shared Neo-Brutalist card chrome: thick border + hard offset shadow. */
const CARD = 'border-2 border-navy rounded-2xl bg-cream shadow-[5px_5px_0px_0px_#1a1c16]';
const CARD_SM = 'border-2 border-navy rounded-xl shadow-[3px_3px_0px_0px_#1a1c16]';

const TIER_UI: Record<Exclude<DailyTier, 'idle'>, { label: string; bg: string; dot: string }> = {
  high: { label: 'High Activity / Significant Changes', bg: 'bg-[#ffdad6]', dot: 'bg-[#ba1a1a]' },
  moderate: { label: 'Moderate Activity', bg: 'bg-[#f6e6a8]', dot: 'bg-[#c8a21a]' },
  low: { label: 'Low Activity / Minor Tweaks', bg: 'bg-[#cdeda3]', dot: 'bg-[#4c662b]' },
};

interface RepoClick {
  onRepoClick?: (name: string) => void;
}

/** A clickable repo name; falls back to plain text when no handler is wired. */
function RepoName({ name, onRepoClick }: { name: string } & RepoClick) {
  if (!onRepoClick) return <span className="break-words font-bold text-navy">{name}</span>;
  return (
    <button
      type="button"
      onClick={() => onRepoClick(name)}
      className="min-w-0 break-words text-left font-bold text-navy hover:underline cursor-pointer"
    >
      {name}
    </button>
  );
}

/** Three-dot traffic-light glyph; `dot` lights the matching lamp. */
function TrafficLight({ dot }: { dot: string }) {
  return (
    <span className="inline-flex items-center gap-1 flex-shrink-0" aria-hidden="true">
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      <span className="h-2.5 w-2.5 rounded-full bg-navy/15" />
      <span className="h-2.5 w-2.5 rounded-full bg-navy/15" />
    </span>
  );
}

function HeaderBlock({ data, trigger, generatedAt }: BentoProps) {
  const time = new Date(generatedAt).toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <header className={`${CARD} flex items-center gap-4 p-5 lg:col-span-2`}>
      <span className="text-4xl leading-none flex-shrink-0" aria-hidden="true">
        🗓️
      </span>
      <div className="min-w-0">
        <h2 className="text-xl font-extrabold uppercase tracking-tight text-navy leading-tight">
          {data.title}
        </h2>
        <p className="text-sm text-navy-light mt-0.5">
          {data.date}
          {data.coverageLabel ? ` · ${data.coverageLabel}` : ` · ${time}`}
        </p>
        <span className="mt-1.5 inline-block rounded-md border-2 border-navy bg-warm-gray px-2 py-0.5 text-xs font-bold text-navy">
          {trigger}
        </span>
      </div>
    </header>
  );
}

function Metric({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="flex min-w-[5rem] flex-1 flex-col items-center text-center">
      <span className={`text-3xl font-extrabold leading-none ${tone ?? 'text-navy'}`}>{value}</span>
      <span className="mt-1 text-[0.65rem] font-semibold uppercase tracking-wide text-navy-light">
        {label}
      </span>
    </div>
  );
}

function MetricsBlock({ data }: { data: DailyNoteData }) {
  const m = data.metrics;
  return (
    <section className={`${CARD} p-5 lg:col-span-2`}>
      <h3 className="mb-3 text-center text-xs font-bold uppercase tracking-widest text-navy-light">
        Global Activity Metrics
      </h3>
      <div className="flex items-end justify-between gap-2">
        <Metric value={String(m.reposTouched)} label="Repos Touched" />
        <Metric value={String(m.filesChanged)} label="Files Changed" />
        <Metric value={`+${m.insertions.toLocaleString()}`} label="Insertions" tone="text-sage" />
        <Metric
          value={`-${m.deletions.toLocaleString()}`}
          label="Deletions"
          tone="text-terracotta"
        />
      </div>
    </section>
  );
}

function ExecutiveSummary({ data }: { data: DailyNoteData }) {
  return (
    <section className={`${CARD} relative p-6 lg:col-span-3`}>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-navy">
        Executive Summary
      </h3>
      <span
        className="absolute left-3 top-9 select-none font-serif text-5xl leading-none text-navy/20"
        aria-hidden="true"
      >
        &ldquo;
      </span>
      <blockquote className="pl-8 pr-4 text-[0.95rem] font-medium leading-relaxed text-navy/90">
        {data.executiveSummary}
      </blockquote>
      <span
        className="absolute bottom-2 right-4 select-none font-serif text-5xl leading-none text-navy/20"
        aria-hidden="true"
      >
        &rdquo;
      </span>
    </section>
  );
}

/** Compact, wrap-safe stat chips derived from the parsed per-repo numbers. */
function StatBadges({ repo }: { repo: DailyRepoLine }) {
  const items: Array<{ text: string; cls: string }> = [];
  if (repo.insertions)
    items.push({ text: `+${repo.insertions.toLocaleString()}`, cls: 'text-sage' });
  if (repo.deletions)
    items.push({ text: `−${repo.deletions.toLocaleString()}`, cls: 'text-terracotta' });
  if (repo.filesChanged) items.push({ text: `${repo.filesChanged}f`, cls: 'text-navy/55' });
  if (repo.untracked) items.push({ text: `${repo.untracked}u`, cls: 'text-navy/45' });
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 pl-4 font-mono text-[0.65rem]">
      {items.map((b, i) => (
        <span key={i} className={b.cls}>
          {b.text}
        </span>
      ))}
    </div>
  );
}

function RepoEntry({ repo, onRepoClick }: { repo: DailyRepoLine } & RepoClick) {
  return (
    <li className="min-w-0 leading-snug">
      <div className="flex min-w-0 items-baseline gap-1">
        <span className="flex-shrink-0 text-navy/50" aria-hidden="true">
          ◷
        </span>
        <RepoName name={repo.name} onRepoClick={onRepoClick} />
      </div>
      {repo.description && (
        <p className="break-words pl-4 text-xs text-navy/75">{repo.description}</p>
      )}
      <StatBadges repo={repo} />
    </li>
  );
}

function TierCard({
  tier,
  repos,
  onRepoClick,
}: { tier: Exclude<DailyTier, 'idle'>; repos: DailyRepoLine[] } & RepoClick) {
  const ui = TIER_UI[tier];
  return (
    <div className={`${CARD_SM} ${ui.bg} flex min-w-0 flex-col gap-2 p-4`}>
      <div className="flex items-center gap-2 border-b-2 border-navy/20 pb-2">
        <TrafficLight dot={ui.dot} />
        <h4 className="break-words text-xs font-extrabold uppercase leading-tight tracking-tight text-navy">
          {ui.label}
        </h4>
      </div>
      {repos.length === 0 ? (
        <p className="text-xs italic text-navy/40">None</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {repos.map((r, i) => (
            <RepoEntry key={`${r.name}-${i}`} repo={r} onRepoClick={onRepoClick} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RepositoryBreakdown({ data, onRepoClick }: { data: DailyNoteData } & RepoClick) {
  return (
    <section className={`${CARD} p-5 lg:col-span-4`}>
      <h3 className="mb-4 text-center text-sm font-bold uppercase tracking-widest text-navy">
        Repository Status Breakdown
      </h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <TierCard tier="high" repos={data.tiers.high} onRepoClick={onRepoClick} />
        <TierCard tier="moderate" repos={data.tiers.moderate} onRepoClick={onRepoClick} />
        <TierCard tier="low" repos={data.tiers.low} onRepoClick={onRepoClick} />
      </div>
    </section>
  );
}

function NotablesSidebar({ data, onRepoClick }: { data: DailyNoteData } & RepoClick) {
  const notables = deriveNotables(data);
  if (notables.length === 0) return null;
  return (
    <aside className={`${CARD} p-5 lg:col-span-1`}>
      <h3 className="mb-3 text-center text-sm font-bold uppercase tracking-widest text-navy">
        Specific Notables
      </h3>
      <ul className="flex flex-col gap-2 text-sm">
        {notables.map((r, i) => {
          const heavyDelete = r.deletions > r.insertions;
          return (
            <li key={`${r.name}-${i}`} className="flex items-baseline gap-2">
              <span className={heavyDelete ? 'text-terracotta' : 'text-sage'} aria-hidden="true">
                {heavyDelete ? '▼' : '▲'}
              </span>
              <span className="min-w-0">
                <RepoName name={r.name} onRepoClick={onRepoClick} />
                {r.description && <span className="text-navy/70"> — {r.description}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function IdleSidebar({ data, onRepoClick }: { data: DailyNoteData } & RepoClick) {
  const idle = data.tiers.idle;
  if (idle.length === 0) return null;
  return (
    <aside className={`${CARD} p-5 lg:col-span-2`}>
      <div className="mb-3 flex items-center justify-center gap-2">
        <TrafficLight dot="bg-navy/30" />
        <h3 className="text-sm font-bold uppercase tracking-widest text-navy">Idle / Untracked</h3>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {idle.map((r, i) => (
          <li key={`${r.name}-${i}`} className="flex items-baseline justify-between gap-2">
            <span className="flex min-w-0 items-baseline gap-1">
              <span className="text-navy/40" aria-hidden="true">
                ◷
              </span>
              <RepoName name={r.name} onRepoClick={onRepoClick} />
            </span>
            {r.untracked > 0 && (
              <span className="flex-shrink-0 font-mono text-xs text-navy/55">({r.untracked})</span>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function AppActivityCard({ data }: { data: DailyNoteData }) {
  if (data.appActivity.length === 0) return null;
  return (
    <section className={`${CARD} p-5 lg:col-span-2`}>
      <h3 className="mb-3 text-sm font-bold uppercase tracking-widest text-navy">App Activity</h3>
      <div className="flex flex-wrap gap-2">
        {data.appActivity.map((e, i) => (
          <span
            key={`${e.label}-${i}`}
            className={`${CARD_SM} bg-warm-gray px-3 py-1.5 text-xs text-navy`}
          >
            <span className="font-semibold">{e.label}</span>
            {e.value && <span className="text-navy/70"> · {e.value}</span>}
          </span>
        ))}
      </div>
    </section>
  );
}

export interface BentoProps extends RepoClick {
  data: DailyNoteData;
  trigger: string;
  /** Epoch ms or ISO string — matches the stored DayNote.generatedAt. */
  generatedAt: string | number;
}

/** Top-level bento grid for one daily-summary note. */
export function DailyNoteBento({ data, trigger, generatedAt, onRepoClick }: BentoProps) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
      <HeaderBlock data={data} trigger={trigger} generatedAt={generatedAt} />
      <MetricsBlock data={data} />
      <ExecutiveSummary data={data} />
      <NotablesSidebar data={data} onRepoClick={onRepoClick} />
      <RepositoryBreakdown data={data} onRepoClick={onRepoClick} />
      <IdleSidebar data={data} onRepoClick={onRepoClick} />
      <AppActivityCard data={data} />
    </div>
  );
}

interface BentoCardProps extends RepoClick {
  note: DayNote;
  data: DailyNoteData;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * One daily-summary note as a bento grid, with the edit/delete controls and the
 * model-attribution footer that the markdown card variant also carries. Keeps
 * NotesTab's render branch small.
 */
export function DailyNoteBentoCard({ note, data, onEdit, onDelete, onRepoClick }: BentoCardProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 self-end text-navy-light">
        {note.editedAt && <span className="text-xs italic text-navy-light/60">(edited)</span>}
        <button
          type="button"
          aria-label="Edit note"
          title="Edit note"
          onClick={onEdit}
          className="flex-shrink-0 cursor-pointer px-1.5 text-sm leading-none text-navy-light/60 transition-colors hover:text-navy"
        >
          &#9998;
        </button>
        <button
          type="button"
          aria-label="Delete note"
          title="Delete note"
          onClick={onDelete}
          className="flex-shrink-0 cursor-pointer px-1.5 text-base leading-none text-navy-light/60 transition-colors hover:text-red-600"
        >
          &times;
        </button>
      </div>
      <DailyNoteBento
        data={data}
        trigger={note.trigger}
        generatedAt={note.generatedAt}
        onRepoClick={onRepoClick}
      />
    </div>
  );
}
