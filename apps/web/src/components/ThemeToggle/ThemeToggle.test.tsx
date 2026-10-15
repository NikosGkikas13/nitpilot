import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_KEY } from '../../theme';
import { ThemeToggle } from './ThemeToggle';

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('ThemeToggle', () => {
  it('switches to the opposite of what is on screen and remembers it', async () => {
    // jsdom has no matchMedia, so "system" shows light here.
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });

  it('starts from the remembered choice', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });
});
