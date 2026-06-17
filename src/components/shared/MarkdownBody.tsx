// MarkdownBody.tsx — canonical ReactMarkdown wrapper used everywhere in Coruro.
//
// Uses .markdown-body CSS class (index.css) for typography. Links open via the
// project's safe URL opener (http/https only). compact prop adds the
// .markdown-body--compact modifier for tighter scale inside modals/panels.

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { safeOpenUrl } from '../../utils/openUrl';

interface MarkdownBodyProps {
  children: string;
  className?: string;
  compact?: boolean;
}

const components: Components = {
  a({ href, children }) {
    const url = href ?? '';
    return (
      <button
        type="button"
        className="markdown-link"
        onClick={() => {
          void safeOpenUrl(url);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void safeOpenUrl(url);
          }
        }}
        title={url}
      >
        {children}
      </button>
    );
  },
};

export function MarkdownBody({ children, className, compact }: MarkdownBodyProps) {
  const cls = ['markdown-body', compact ? 'markdown-body--compact' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
