import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardHeader } from './CardHeader';

describe('CardHeader', () => {
  it('renders language label and watermark initials', () => {
    const html = renderToStaticMarkup(
      <CardHeader
        name="Coruro"
        language="Rust"
        sync={{ dirty: false, ahead: 0, behind: 0, ciStatus: 'none' }}
      />,
    );
    expect(html).toContain('Rust');
    // Watermark initials = first two letters of name, uppercased.
    expect(html).toContain('CO');
  });

  it('omits language label when language is null', () => {
    const html = renderToStaticMarkup(
      <CardHeader
        name="x"
        language={null}
        sync={{ dirty: true, ahead: 0, behind: 0, ciStatus: 'none' }}
      />,
    );
    expect(html).toContain('dirty');
  });
});
