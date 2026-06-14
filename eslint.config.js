// Flat ESLint config (ESLint 9). Enforces the one TS/React style for the gate.
// Deviations from the Engineering Constitution are deliberate and annotated:
//   - max-lines-per-function is a WARN at 120 (React JSX render functions are
//     declarative markup, not the imperative logic the 40-LOC rule targets).
//   - no-console is a warn that still permits console.error / console.warn.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'src-tauri/target',
      'ai-sidecar/.build',
      '*.config.js',
      '*.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'max-lines-per-function': ['warn', { max: 120, skipBlankLines: true, skipComments: true }],
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/__tests__/**/*.{ts,tsx}'],
    rules: {
      'max-lines-per-function': 'off',
      complexity: 'off',
    },
  },
);
