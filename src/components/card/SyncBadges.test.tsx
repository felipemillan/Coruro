import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SyncBadges } from './SyncBadges';

describe('SyncBadges', () => {
  it('shows dirty and ahead/behind counts', () => {
    const html = renderToStaticMarkup(
      <SyncBadges sync={{ dirty: true, ahead: 2, behind: 1, ciStatus: 'success' }} />,
    );
    expect(html).toContain('dirty');
    expect(html).toContain('2');
    expect(html).toContain('1');
  });

  it('shows clean and hides zero ahead/behind', () => {
    const html = renderToStaticMarkup(
      <SyncBadges sync={{ dirty: false, ahead: 0, behind: 0, ciStatus: 'none' }} />,
    );
    expect(html).toContain('clean');
  });
});
