import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiBanner } from './AiBanner';

vi.mock('../store/useBoardStore', () => ({
  useBoardStore: (sel: (s: unknown) => unknown) =>
    sel({ aiUnavailableReason: 'appleIntelligenceNotEnabled' }),
}));

describe('AiBanner', () => {
  it('renders the unavailable message when a reason is set', () => {
    const html = renderToStaticMarkup(<AiBanner />);
    expect(html).toContain('Apple Intelligence');
  });
});
