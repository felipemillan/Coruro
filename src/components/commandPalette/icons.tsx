/**
 * icons.tsx — Lightweight inline SVG icons for CommandPalette item groups.
 * Avoids importing all of lucide-react.
 */

export function SkillIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, color: 'var(--color-primary)', marginTop: 2 }}
    >
      <path
        d="M8 1L9.8 5.8L15 6.3L11.2 9.7L12.4 15L8 12.4L3.6 15L4.8 9.7L1 6.3L6.2 5.8L8 1Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AgentIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, color: 'var(--color-secondary)', marginTop: 2 }}
    >
      <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CommandIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, color: 'var(--color-tertiary)', marginTop: 2 }}
    >
      <path d="M4 3h8M4 8h8M4 13h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function McpIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, color: 'var(--color-outline)', marginTop: 2 }}
    >
      <rect x="2" y="2" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="2" fill="currentColor" opacity="0.6" />
    </svg>
  );
}
