import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Wordmark } from './Wordmark';

describe('Wordmark', () => {
  it('is announced as the product name, not as its letters', () => {
    render(<Wordmark />);
    expect(screen.getByRole('img', { name: 'Nitpilot' })).toBeInTheDocument();
  });

  it('draws the name with a dotless i', () => {
    const { container } = render(<Wordmark size={22} />);
    expect(container.textContent).toBe('nıtpilot');
  });
});
