// Auto-refresh section for the Settings modal.

import { useBoardStore } from '../../store/useBoardStore';
import { SectionHeading } from './SectionHeading';

export function AutoRefreshSection() {
  const refreshIntervalMin = useBoardStore((s) => s.settings.refreshIntervalMin);
  const setRefreshInterval = useBoardStore((s) => s.setRefreshInterval);

  return (
    <section>
      <SectionHeading>Auto-refresh</SectionHeading>
      <p className="text-[12px] text-navy-light mb-3 leading-relaxed">
        How often to refresh GitHub data in the background. Per-card refresh and rescan always work
        regardless of this setting.
      </p>
      <label className="block text-[11px] text-navy-light mb-1">Interval</label>
      <select
        value={refreshIntervalMin}
        onChange={(e) => {
          void setRefreshInterval(Number(e.target.value));
        }}
        className="
          w-full px-3 py-2
          rounded-lg
          bg-warm-gray border border-warm-gray/80
          text-[12px] text-navy
          focus:outline-none focus:border-navy/40 focus:bg-cream
          transition-colors duration-150 cursor-pointer
        "
      >
        <option value={0}>Off</option>
        <option value={5}>Every 5 minutes</option>
        <option value={10}>Every 10 minutes</option>
        <option value={15}>Every 15 minutes</option>
        <option value={30}>Every 30 minutes</option>
        <option value={60}>Every hour</option>
      </select>
    </section>
  );
}
