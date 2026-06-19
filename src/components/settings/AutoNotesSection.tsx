// Auto Notes section for the Settings modal.

import { useBoardStore } from '../../store/useBoardStore';
import { SectionHeading } from './SectionHeading';

export function AutoNotesSection() {
  const autoNotesEnabled = useBoardStore((s) => s.settings.autoNotesEnabled);
  const autoNotesIntervalMin = useBoardStore((s) => s.settings.autoNotesIntervalMin);
  const setAutoNotesEnabled = useBoardStore((s) => s.setAutoNotesEnabled);
  const setAutoNotesIntervalMin = useBoardStore((s) => s.setAutoNotesIntervalMin);

  return (
    <section>
      <SectionHeading>Auto Notes</SectionHeading>
      <p className="text-[12px] text-navy-light mb-3 leading-relaxed">
        Automatically generate and append day notes from your recent commits.
      </p>
      <label className="flex items-center gap-3 cursor-pointer mb-3">
        <input
          type="checkbox"
          checked={autoNotesEnabled}
          onChange={(e) => void setAutoNotesEnabled(e.target.checked)}
          className="w-4 h-4 accent-navy"
        />
        <span className="text-[12px] text-navy">Enable hourly auto notes</span>
      </label>
      {autoNotesEnabled && (
        <label className="flex items-center gap-2">
          <span className="text-[12px] text-navy whitespace-nowrap">Interval (minutes)</span>
          <input
            type="number"
            min="1"
            step="1"
            value={autoNotesIntervalMin}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (v > 0) void setAutoNotesIntervalMin(v);
            }}
            className="nb-input flex-1 px-3 py-2 text-[12px] text-navy placeholder:text-navy-light/40 transition-colors duration-150"
          />
        </label>
      )}
    </section>
  );
}
