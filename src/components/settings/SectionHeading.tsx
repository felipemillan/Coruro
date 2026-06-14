// Shared heading component for settings sections.

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-widest text-navy-light mb-3 select-none">
      {children}
    </h3>
  );
}
