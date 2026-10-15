import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY } from '../../theme';
import { ThemeToggle } from './ThemeToggle';

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

/** A stand-in for the browser's dark-mode media query: the test can flip the system theme and announce it. */
function fakeSystemTheme(startsDark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: startsDark,
    addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    switchTo(dark: boolean) {
      query.matches = dark;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

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

  it('follows a dark system when nothing is saved', () => {
    fakeSystemTheme(true);
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });

  it('keeps its label in step when the system theme changes', () => {
    const system = fakeSystemTheme(true);
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
    system.switchTo(false);
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
  });
});
