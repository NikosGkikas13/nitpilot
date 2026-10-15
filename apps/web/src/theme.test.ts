import { describe, expect, it } from 'vitest';
import { applyTheme, readTheme, shownTheme, THEME_KEY, writeTheme } from './theme';

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
    items,
  };
}

describe('theme', () => {
  it('reads a saved choice, and anything else as "system"', () => {
    expect(readTheme(memory({ [THEME_KEY]: 'dark' }))).toBe('dark');
    expect(readTheme(memory({ [THEME_KEY]: 'purple' }))).toBe('system');
    expect(readTheme(memory())).toBe('system');
    expect(readTheme(null)).toBe('system');
  });

  it('falls back to "system" when storage throws', () => {
    const broken = { getItem: () => { throw new Error('SecurityError'); } };
    expect(readTheme(broken)).toBe('system');
  });

  it('remembers light and dark, and forgets "system"', () => {
    const store = memory();
    writeTheme('dark', store);
    expect(store.items.get(THEME_KEY)).toBe('dark');
    writeTheme('system', store);
    expect(store.items.has(THEME_KEY)).toBe(false);
  });

  it('does not throw when storage refuses to save', () => {
    const full = { setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
    expect(() => writeTheme('light', full)).not.toThrow();
  });

  it('sets data-theme for light and dark, and removes it for system', () => {
    const root = document.createElement('html');
    applyTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');
    applyTheme('system', root);
    expect(root.dataset.theme).toBeUndefined();
  });

  it('works out the theme on screen', () => {
    expect(shownTheme('system', true)).toBe('dark');
    expect(shownTheme('system', false)).toBe('light');
    expect(shownTheme('light', true)).toBe('light');
  });
});
