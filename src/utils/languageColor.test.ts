import { describe, it, expect } from 'vitest';
import { languageColor } from './languageColor';

describe('languageColor', () => {
  it('returns the known color for a language (case-insensitive)', () => {
    expect(languageColor('TypeScript')).toBe('#3178c6');
    expect(languageColor('typescript')).toBe('#3178c6');
    expect(languageColor('Rust')).toBe('#dea584');
  });

  it('returns the neutral fallback for unknown or null languages', () => {
    expect(languageColor(null)).toBe('#9ca3af');
    expect(languageColor('Nonsense')).toBe('#9ca3af');
  });
});
