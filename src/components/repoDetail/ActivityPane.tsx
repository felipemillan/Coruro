// ActivityPane.tsx — lazy-loaded GitHub activity: open PRs, commits, issues.

import { ExternalLink, GitPullRequest, GitCommit, CircleDot } from 'lucide-react';
import type { GhActivity } from '../../utils/githubActivity';

interface ActivityPaneProps {
  activity: GhActivity | null;
  loading: boolean;
  error: string | null;
  hasRemote: boolean;
  onOpen: (url: string) => void;
}

// Hoisted outside render to avoid react-hooks/static-components error.
function ActivityRow({
  url,
  onOpen,
  children,
}: {
  url: string;
  onOpen: (url: string) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(url)}
      className="flex items-start gap-1.5 w-full px-3 py-1.5 text-left text-[12px] text-navy-light hover:bg-warm-gray transition-colors cursor-pointer"
      title={url}
    >
      <ExternalLink size={10} strokeWidth={1.5} className="shrink-0 mt-0.5 text-navy-light/40" />
      <span className="truncate">{children}</span>
    </button>
  );
}

function ActivityHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-navy-light/50 select-none">
      {children}
    </div>
  );
}

type GhActivityData = NonNullable<GhActivity>;

function PrSection({ prs, onOpen }: { prs: GhActivityData['prs']; onOpen: (url: string) => void }) {
  if (prs.length === 0) return null;
  return (
    <section>
      <ActivityHeading>
        <GitPullRequest size={10} strokeWidth={1.5} className="inline mr-1" />
        Open PRs
      </ActivityHeading>
      {prs.map((p) => (
        <ActivityRow key={p.number} url={p.url} onOpen={onOpen}>
          <span className="font-mono text-navy-light/50">#{p.number}</span> {p.title}
          {p.draft && <span className="ml-1 text-[10px] text-navy-light/40">(draft)</span>}
        </ActivityRow>
      ))}
    </section>
  );
}

function CommitSection({
  commits,
  onOpen,
}: {
  commits: GhActivityData['commits'];
  onOpen: (url: string) => void;
}) {
  if (commits.length === 0) return null;
  return (
    <section>
      <ActivityHeading>
        <GitCommit size={10} strokeWidth={1.5} className="inline mr-1" />
        Recent commits
      </ActivityHeading>
      {commits.map((c) => (
        <ActivityRow key={c.sha} url={c.url} onOpen={onOpen}>
          {c.message} <span className="text-navy-light/40">· {c.author}</span>
        </ActivityRow>
      ))}
    </section>
  );
}

function IssueSection({
  issues,
  onOpen,
}: {
  issues: GhActivityData['issues'];
  onOpen: (url: string) => void;
}) {
  if (issues.length === 0) return null;
  return (
    <section>
      <ActivityHeading>
        <CircleDot size={10} strokeWidth={1.5} className="inline mr-1" />
        Recent issues
      </ActivityHeading>
      {issues.map((i) => (
        <ActivityRow key={i.number} url={i.url} onOpen={onOpen}>
          <span className="font-mono text-navy-light/50">#{i.number}</span> {i.title}
        </ActivityRow>
      ))}
    </section>
  );
}

export function ActivityPane({ activity, loading, error, hasRemote, onOpen }: ActivityPaneProps) {
  if (!hasRemote)
    return <p className="px-3 py-2 text-[12px] text-navy-light/50 italic">No github.com remote.</p>;
  if (loading) return <p className="px-3 py-2 text-[12px] text-navy-light/50">Loading activity…</p>;
  if (error !== null)
    return <p className="px-3 py-2 text-[12px] text-terracotta font-mono">{error}</p>;
  if (activity === null) return null;

  const empty =
    activity.prs.length === 0 && activity.commits.length === 0 && activity.issues.length === 0;
  if (empty)
    return <p className="px-3 py-2 text-[12px] text-navy-light/50 italic">No recent activity.</p>;

  return (
    <div className="flex flex-col gap-2 pb-2">
      <PrSection prs={activity.prs} onOpen={onOpen} />
      <CommitSection commits={activity.commits} onOpen={onOpen} />
      <IssueSection issues={activity.issues} onOpen={onOpen} />
    </div>
  );
}
