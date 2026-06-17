// markdownComponents.tsx — shared UI primitives for the Command Center.
// Markdown rendering is now handled by MarkdownBody (src/components/shared/MarkdownBody.tsx).

/** Uppercase muted section label used across the Command Center. */
export function SectionHeader({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-navy-light mb-2">
      {label}
    </p>
  );
}
