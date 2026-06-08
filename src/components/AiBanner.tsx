// AiBanner.tsx — one-time notice when on-device Apple Intelligence is unavailable.
// Reads aiUnavailableReason from the store; renders nothing when null.

import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useBoardStore } from '../store/useBoardStore';

const MESSAGE: Record<string, string> = {
  deviceNotEligible: 'This Mac cannot run Apple Intelligence, so AI summaries are disabled.',
  appleIntelligenceNotEnabled: 'Apple Intelligence is off. Enable it in System Settings › Apple Intelligence to get AI summaries.',
  modelNotReady: 'The Apple Intelligence model is still downloading. AI summaries will appear once it is ready.',
};

export function AiBanner() {
  const reason = useBoardStore((s) => s.aiUnavailableReason);
  const [dismissed, setDismissed] = useState(false);
  if (!reason || dismissed) return null;
  const msg = MESSAGE[reason] ?? 'Apple Intelligence is unavailable, so AI summaries are disabled.';
  return (
    <div className="flex items-center gap-2 bg-amber-500/15 text-navy text-xs px-3 py-2 border-b border-amber-500/30" role="status">
      <Sparkles size={13} strokeWidth={2} className="text-amber-500 shrink-0" />
      <span className="flex-1">{msg}</span>
      <button type="button" onClick={() => setDismissed(true)} className="text-navy-light hover:text-navy" aria-label="Dismiss">
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  );
}
