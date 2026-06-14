/**
 * ItemLabel.tsx — Shared label sub-component used inside CommandItem rows.
 * Renders name + invocation string on the first line, blurb (or loading state) below.
 */

export interface ItemLabelProps {
  name: string;
  blurb: string | null;
  loadingBlurb: boolean;
  invocation: string;
}

export function ItemLabel({ name, blurb, loadingBlurb, invocation }: ItemLabelProps) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: 'var(--color-on-surface)',
          }}
        >
          {name}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-on-surface-variant)',
            fontFamily: '"SFMono-Regular", ui-monospace, Menlo, monospace',
          }}
        >
          {invocation}
        </span>
      </div>
      {blurb ? (
        <span
          style={{
            fontSize: 12,
            color: 'var(--color-on-surface-variant)',
            lineHeight: 1.4,
          }}
        >
          {blurb}
        </span>
      ) : loadingBlurb ? (
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-outline)',
            fontStyle: 'italic',
          }}
        >
          Loading AI description…
        </span>
      ) : null}
    </>
  );
}
