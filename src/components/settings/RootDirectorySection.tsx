// Root directory section for the Settings modal.
// Owns the folder-picker dialog and triggers a rescan on selection.

import { useCallback, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useBoardStore } from '../../store/useBoardStore';
import { SectionHeading } from './SectionHeading';

export function RootDirectorySection() {
  const rootDirectory = useBoardStore((s) => s.settings.rootDirectory);
  const setRootDirectory = useBoardStore((s) => s.setRootDirectory);
  const scanAndDistribute = useBoardStore((s) => s.scanAndDistribute);

  const [dirPicking, setDirPicking] = useState(false);

  const handlePickDirectory = useCallback(async () => {
    if (dirPicking) return;
    setDirPicking(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select root directory for repos',
      });
      if (typeof selected === 'string' && selected.length > 0) {
        await setRootDirectory(selected);
        await scanAndDistribute(selected);
      }
    } catch {
      // User dismissed the dialog or dialog failed — no-op.
    } finally {
      setDirPicking(false);
    }
  }, [dirPicking, setRootDirectory, scanAndDistribute]);

  return (
    <section>
      <SectionHeading>Root directory</SectionHeading>
      <p className="text-[12px] text-navy-light mb-3 leading-relaxed">
        The folder scanned for local Git repositories. Any subdirectory with a{' '}
        <code className="font-mono text-[11px] bg-warm-gray px-1 py-0.5">.git</code> folder is
        picked up automatically.
      </p>

      {/* Current path display */}
      <div className="nb-card-sm flex items-center px-3 py-2 mb-3 text-[12px] font-mono text-navy-light overflow-hidden">
        {rootDirectory !== null ? (
          <span className="truncate select-all">{rootDirectory}</span>
        ) : (
          <span className="italic text-navy-light/50">Not set</span>
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
    </section>
  );
}
