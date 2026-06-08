import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatGrid } from './StatGrid';

describe('StatGrid', () => {
  it('renders all three stats with values and labels', () => {
    const html = renderToStaticMarkup(
      <StatGrid stats={[
        { value: '128', label: 'STARS' },
        { value: '12', label: 'ISSUES' },
        { value: '4', label: 'FORKS' },
      ]} />,
    );
    expect(html).toContain('128');
    expect(html).toContain('STARS');
    expect(html).toContain('FORKS');
  });
});
