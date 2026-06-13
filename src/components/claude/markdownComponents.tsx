// markdownComponents.tsx — shared ReactMarkdown renderers + SectionHeader for
// the Command Center. Extracted so the AI Health panel and the Setup Curator
// narrative render identically without duplicating the component map.

import type { Components } from 'react-markdown';

export const mdComponents: Components = {
  p({ children }) {
    return <p className="mb-2 last:mb-0 leading-relaxed text-navy/90">{children}</p>;
  },
  li({ children }) {
    return <li className="mb-0.5 leading-snug">{children}</li>;
  },
  h1({ children }) {
    return (
      <h1 className="text-base font-bold text-navy mt-4 mb-2 pb-1 border-b border-warm-gray/50 first:mt-0">
        {children}
      </h1>
    );
  },
  h2({ children }) {
    return (
      <h2 className="text-sm font-semibold text-navy mt-4 mb-1.5 pb-0.5 border-b border-warm-gray/30 first:mt-0">
        {children}
      </h2>
    );
  },
  h3({ children }) {
    return (
      <h3 className="text-xs font-semibold text-navy/70 mt-3 mb-1 pl-2 border-l-2 border-sage/60 first:mt-0">
        {children}
      </h3>
    );
  },
  ul({ children }) {
    return (
      <ul className="list-disc list-outside ml-4 space-y-0.5 text-sm text-navy/85 mb-2">
        {children}
      </ul>
    );
  },
  ol({ children }) {
    return (
      <ol className="list-decimal list-outside ml-4 space-y-0.5 text-sm text-navy/85 mb-2">
        {children}
      </ol>
    );
  },
  code({ children }) {
    return (
      <code className="font-mono text-xs bg-navy/6 border border-navy/10 px-1 py-0.5 rounded">
        {children}
      </code>
    );
  },
  strong({ children }) {
    return <strong className="font-semibold text-navy">{children}</strong>;
  },
  hr() {
    return <hr className="border-warm-gray/30 my-3" />;
  },
};

/** Uppercase muted section label used across the Command Center. */
export function SectionHeader({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-navy-light mb-2">
      {label}
    </p>
  );
}
