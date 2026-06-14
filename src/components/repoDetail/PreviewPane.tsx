// PreviewPane.tsx — right-pane top half: markdown doc or AI summary switcher.

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles } from 'lucide-react';
import { AiSummaryPane } from './AiSummaryPane';
import type { Repo } from '../../types';

interface AiProps {
  summary: string | undefined;
  tags: string[];
  model: string | null;
  analyzedAt: string | null;
  analyzing: boolean;
  unavailableReason: string | null;
  onReanalyze: () => void;
}

interface PreviewPaneProps {
  previewMode: 'doc' | 'ai';
  onSetPreviewMode: (mode: 'doc' | 'ai') => void;
  previewTitle: string;
  previewContent: string | null;
  loading: boolean;
  error: string | null;
  hasSelectedFile: boolean;
  fileBodyLoading: boolean;
  repo: Repo;
  ai: AiProps;
}

function DocBody({
  loading,
  error,
  previewContent,
  fileBodyLoading,
}: {
  loading: boolean;
  error: string | null;
  previewContent: string | null;
  fileBodyLoading: boolean;
}) {
  if (loading) return <p className="p-6 text-[13px] text-navy-light/50">Loading…</p>;
  if (error !== null) return <p className="p-6 text-[13px] text-terracotta font-mono">{error}</p>;
  if (previewContent !== null) {
    return (
      <div className="markdown-body p-6 max-w-[820px]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewContent}</ReactMarkdown>
      </div>
    );
  }
  if (fileBodyLoading) return <p className="p-6 text-[13px] text-navy-light/50">Loading file…</p>;
  return (
    <p className="p-6 text-[13px] text-navy-light/50 italic">
      No README found. Pick a markdown file on the left.
    </p>
  );
}

export function PreviewPane({
  previewMode,
  onSetPreviewMode,
  previewTitle,
  previewContent,
  loading,
  error,
  hasSelectedFile,
  fileBodyLoading,
  ai,
}: PreviewPaneProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col border border-warm-gray rounded-xl overflow-hidden mb-1.5">
      {/* Preview tab bar: markdown doc (README/file) | AI Summary */}
      <div className="shrink-0 flex items-center border-b border-warm-gray bg-cream/60">
        <button
          type="button"
          onClick={() => onSetPreviewMode('doc')}
          className={`px-4 py-2 text-[10px] font-semibold uppercase tracking-widest transition-colors cursor-pointer ${
            previewMode === 'doc' ? 'text-navy bg-cream' : 'text-navy-light/60 hover:text-navy'
          }`}
        >
          {hasSelectedFile ? 'Preview' : 'README'}
        </button>
        <button
          type="button"
          onClick={() => onSetPreviewMode('ai')}
          className={`flex items-center gap-1 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest transition-colors cursor-pointer ${
            previewMode === 'ai' ? 'text-navy bg-cream' : 'text-navy-light/60 hover:text-navy'
          }`}
        >
          <Sparkles
            size={11}
            strokeWidth={1.75}
            className={previewMode === 'ai' ? 'text-sage' : ''}
          />
          AI Summary
        </button>
        {previewMode === 'doc' && (
          <span className="ml-auto px-4 text-[10px] font-mono text-navy-light/40 truncate select-none">
            {previewTitle}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto min-h-0">
        {previewMode === 'ai' ? (
          <AiSummaryPane {...ai} />
        ) : (
          <DocBody
            loading={loading}
            error={error}
            previewContent={previewContent}
            fileBodyLoading={fileBodyLoading}
          />
        )}
      </div>
    </div>
  );
}
