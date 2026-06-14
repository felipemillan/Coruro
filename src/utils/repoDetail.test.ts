import { describe, expect, test } from 'vitest';
import { pruneToMarkdown } from './repoDetail';
import type { TreeNode } from './repoDetail';

const f = (name: string, path: string): TreeNode => ({ name, path, isDir: false });
const d = (name: string, path: string, children: TreeNode[]): TreeNode => ({
  name,
  path,
  isDir: true,
  children,
});

describe('pruneToMarkdown', () => {
  test('keeps .md leaves, drops non-md leaves', () => {
    const input = [f('README.md', '/r/README.md'), f('main.ts', '/r/main.ts')];
    expect(pruneToMarkdown(input)).toEqual([f('README.md', '/r/README.md')]);
  });

  test('keeps dirs only when they contain a .md descendant', () => {
    const input = [
      d('docs', '/r/docs', [f('guide.md', '/r/docs/guide.md'), f('x.png', '/r/docs/x.png')]),
      d('src', '/r/src', [f('main.ts', '/r/src/main.ts')]),
    ];
    expect(pruneToMarkdown(input)).toEqual([
      d('docs', '/r/docs', [f('guide.md', '/r/docs/guide.md')]),
    ]);
  });

  test('is case-insensitive on the .md extension', () => {
    const input = [f('NOTES.MD', '/r/NOTES.MD')];
    expect(pruneToMarkdown(input)).toEqual([f('NOTES.MD', '/r/NOTES.MD')]);
  });

  test('empty input → empty output', () => {
    expect(pruneToMarkdown([])).toEqual([]);
  });
});
