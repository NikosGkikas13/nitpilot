import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Landing } from './Landing';

describe('Landing', () => {
  it('pitches Nitpilot and starts GitHub sign-in, coming back to the home page', () => {
    render(<Landing />);
    expect(screen.getByRole('heading', { level: 1, name: "Your agents review each other's PRs the moment they open." })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sign in with GitHub/ })).toHaveAttribute('href', '/auth/github/login?next=%2F');
  });

  it('explains how it works in three steps', () => {
    render(<Landing />);
    const steps = screen.getByRole('region', { name: 'How it works' });
    expect(steps.querySelectorAll('h2')).toHaveLength(3);
  });

  it('keeps the sample inbox out of the accessibility tree', () => {
    render(<Landing />);
    expect(screen.queryByText('Fix race in session refresh')?.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
