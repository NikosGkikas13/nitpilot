import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OnThisPage } from './OnThisPage';

const headings = [
  { id: 'try-it', text: 'Try it', depth: 2 as const },
  { id: 'step-one', text: 'Step one', depth: 3 as const },
  { id: 'try-it-2', text: 'Try it', depth: 2 as const },
];

describe('OnThisPage', () => {
  it('links to every heading and marks the first current without IntersectionObserver', () => {
    expect(window.IntersectionObserver).toBeUndefined();
    render(<OnThisPage headings={headings} />);
    const nav = screen.getByRole('navigation', { name: 'On this page' });
    const links = nav.querySelectorAll('a');
    expect([...links].map((a) => a.getAttribute('href'))).toEqual(['#try-it', '#step-one', '#try-it-2']);
    expect(links[0]).toHaveAttribute('aria-current', 'location');
    expect(links[1]).not.toHaveAttribute('aria-current');
  });

  it('renders nothing without headings', () => {
    const { container } = render(<OnThisPage headings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
