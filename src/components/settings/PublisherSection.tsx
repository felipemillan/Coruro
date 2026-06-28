// Publisher section for the Settings modal.
// Owns the asset output-directory picker (enables local share-image rendering)
// and the default-target selector. Both persist via the settings slice.

import { useCallback, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useBoardStore } from '../../store/useBoardStore';
import type { PublisherTarget } from '../../types';
import { SectionHeading } from './SectionHeading';

export function PublisherSection() {
  const outputDir = useBoardStore((s) => s.settings.publisherOutputDir);
  const defaultTarget = useBoardStore((s) => s.settings.publisherDefaultTarget);
  const setPublisherOutputDir = useBoardStore((s) => s.setPublisherOutputDir);
  const setPublisherDefaultTarget = useBoardStore((s) => s.setPublisherDefaultTarget);

  const [dirPicking, setDirPicking] = useState(false);

  const handlePickDirectory = useCallback(async () => {
    if (dirPicking) return;
    setDirPicking(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select output directory for Publisher share images',
      });
      if (typeof selected === 'string' && selected.length > 0) {
        await setPublisherOutputDir(selected);
      }
    } catch {
      // User dismissed the dialog or dialog failed — no-op.
    } finally {
      setDirPicking(false);
    }
  }, [dirPicking, setPublisherOutputDir]);

  return (
    <section>
      <SectionHeading>Publisher</SectionHeading>
      <p className="text-[12px] text-navy-light mb-3 leading-relaxed">
        Where rendered share images are written. Leave unset to draft text only — drafts always
        work; setting a folder turns on local image export.
      </p>

      {/* Current path display + clear affordance */}
      <div className="nb-card-sm flex items-center gap-2 px-3 py-2 mb-3 text-[12px] font-mono text-navy-light overflow-hidden">
        {outputDir !== null ? (
          <>
            <span className="truncate select-all flex-1">{outputDir}</span>
            <button
              type="button"
              onClick={() => void setPublisherOutputDir(null)}
              aria-label="Clear Publisher output directory"
              className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-navy-light hover:text-navy hover:bg-navy/8 transition-colors duration-150 cursor-pointer"
            >
              <X size={13} strokeWidth={1.5} />
            </button>
          </>
        ) : (
          <span className="italic text-navy-light/50">Not set — text drafts only</span>
        )}
      </div>

      <button
        type="button"
        onClick={() => void handlePickDirectory()}
        disabled={dirPicking}
        className="nb-btn flex items-center gap-2 px-4 py-2 bg-navy text-cream text-[12px] font-medium hover:bg-navy-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer"
      >
        <FolderOpen size={13} strokeWidth={1.5} />
        {dirPicking ? 'Picking…' : 'Choose folder'}
      </button>

      <label className="block text-[11px] text-navy-light mt-4 mb-1">Default target</label>
      <select
        value={defaultTarget}
        onChange={(e) => {
          void setPublisherDefaultTarget(e.target.value as PublisherTarget);
        }}
        className="nb-input w-full px-3 py-2 text-[12px] text-navy transition-colors duration-150 cursor-pointer"
      >
        <option value="linkedin">LinkedIn</option>
        <option value="reddit">Reddit</option>
      </select>
    </section>
  );
}
