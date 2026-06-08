// languageColor.ts — map a programming language to a representative hex color.
// Subset of GitHub Linguist colors; keys are matched case-insensitively.
// Unknown / null languages fall back to a neutral gray.

const NEUTRAL = '#9ca3af';

const COLORS: Record<string, string> = {
  typescript: '#3178c6',
  javascript: '#f1e05a',
  rust: '#dea584',
  python: '#3572a5',
  go: '#00add8',
  swift: '#f05138',
  java: '#b07219',
  kotlin: '#a97bff',
  ruby: '#701516',
  c: '#555555',
  'c++': '#f34b7d',
  'c#': '#178600',
  php: '#4f5d95',
  html: '#e34c26',
  css: '#563d7c',
  shell: '#89e051',
  vue: '#41b883',
  svelte: '#ff3e00',
  dart: '#00b4ab',
  elixir: '#6e4a7e',
  scala: '#c22d40',
  haskell: '#5e5086',
  lua: '#000080',
  zig: '#ec915c',
};

/** Hex color for a language name, or a neutral fallback when unknown/null. */
export function languageColor(language: string | null | undefined): string {
  if (!language) return NEUTRAL;
  return COLORS[language.toLowerCase()] ?? NEUTRAL;
}
