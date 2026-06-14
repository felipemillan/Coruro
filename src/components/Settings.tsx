// Settings modal for Coruro.
//
// Self-contained: open state is owned by the parent (App), which exposes it
// via a floating gear button and the ⌘, shortcut. Settings renders nothing
// but the modal — no trigger of its own.
//
// Two-column layout:
//   Left  — Root directory · GitHub PAT
//   Right — Editor · Terminal · Auto-refresh · Auto Notes · Debug

import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Settings as SettingsIcon, X } from 'lucide-react';
import { RootDirectorySection } from './settings/RootDirectorySection';
import { GitHubTokenSection } from './settings/GitHubTokenSection';
import { EditorSection } from './settings/EditorSection';
import { TerminalSection } from './settings/TerminalSection';
import { AutoRefreshSection } from './settings/AutoRefreshSection';
import { AutoNotesSection } from './settings/AutoNotesSection';
import { DebugSection } from './settings/DebugSection';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Settings({ isOpen, onClose }: SettingsProps) {
  const handleCloseModal = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) handleCloseModal();
    },
    [handleCloseModal],
  );

  // Close on Escape — the full-viewport panel covers the overlay, so
  // click-outside is no longer reachable; keyboard is the escape hatch.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') handleCloseModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, handleCloseModal]);

  return (
    <>
      {isOpen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            className="
              fixed inset-0 z-50
              flex items-center justify-center
              backdrop-blur-md bg-navy/20
            "
            onClick={handleOverlayClick}
          >
            {/* Panel — full viewport */}
            <div
              className="
                relative
                w-screen h-screen
                bg-cream
                flex flex-col
                overflow-hidden
              "
            >
              {/* Panel header */}
              <div className="shrink-0 flex items-center justify-between px-6 py-4 bg-warm-gray border-b border-warm-gray/60">
                <div className="flex items-center gap-2">
                  <SettingsIcon size={14} strokeWidth={1.5} className="text-navy-light" />
                  <span className="text-[13px] font-semibold text-navy tracking-wide select-none">
                    Settings
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  aria-label="Close settings"
                  className="
                    flex items-center justify-center
                    w-6 h-6
                    rounded-full
                    text-navy-light hover:text-navy hover:bg-navy/8
                    transition-colors duration-150
                    cursor-pointer
                  "
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              </div>

              {/* Panel body — two columns */}
              <div className="flex-1 overflow-auto px-8 py-6">
                <div className="mx-auto w-full max-w-[1100px] grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
                  {/* ===== Left column ===== */}
                  <div className="flex flex-col gap-6">
                    <RootDirectorySection />
                    <div className="border-t border-warm-gray" />
                    <GitHubTokenSection />
                  </div>

                  {/* ===== Right column ===== */}
                  <div className="flex flex-col gap-6">
                    <EditorSection />
                    <div className="border-t border-warm-gray" />
                    <TerminalSection />
                    <div className="border-t border-warm-gray" />
                    <AutoRefreshSection />
                    <div className="border-t border-warm-gray" />
                    <AutoNotesSection />
                    <div className="border-t border-warm-gray" />
                    <DebugSection />
                  </div>
                </div>
              </div>

              {/* Panel footer */}
              <div
                className="
                  shrink-0
                  px-6 py-3
                  bg-warm-gray/50 border-t border-warm-gray/60
                  flex justify-end
                "
              >
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="
                    px-4 py-1.5
                    text-[12px] text-navy-light
                    hover:text-navy hover:bg-warm-gray
                    transition-colors duration-150
                    cursor-pointer
                  "
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
