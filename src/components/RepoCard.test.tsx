import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RepoCard } from './RepoCard';
import type { Repo } from '../types';

// Stub stores so the component renders without a live Zustand provider.
vi.mock('../store/useBoardStore', () => ({
  useBoardStore: (sel: (s: unknown) => unknown) =>
    sel({
      settings: { editorCommand: 'code', editorApp: 'VS Code', terminalApp: 'Terminal' },
      repoMetadata: {},
      setRepoCustomName: () => {},
      enrichOne: () => {},
      analyzingPaths: new Set(),
      enrichAiOne: () => {},
    }),
}));
vi.mock('../store/useViewStore', () => ({
  useViewStore: (sel: (s: unknown) => unknown) => sel({ setDetail: () => {} }),
}));

const localRepo: Repo = {
  name: 'Coruro',
  path: '/x/Coruro',
  branch: 'main',
  dirty: true,
  prCount: 0,
  commitCount: 340,
  branchCount: 6,
  lastCommitAt: '2026-06-05T00:00:00Z',
};

describe('RepoCard', () => {
  it('renders name, local stats, and the data-path attribute', () => {
    const html = renderToStaticMarkup(<RepoCard repo={localRepo} />);
    expect(html).toContain('Coruro');
    expect(html).toContain('340');
    expect(html).toContain('COMMITS');
    expect(html).toContain('data-path="/x/Coruro"');
  });
});
