import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIsDesktop } from './viewport';

afterEach(() => vi.unstubAllGlobals());

describe('useIsDesktop', () => {
  it('listens once, however often the page re-renders, and follows a resize', () => {
    let matches = false;
    const listeners = new Set<() => void>();
    const added = vi.fn();
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, fn: () => void) => (added(), listeners.add(fn)),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    const { result, rerender } = renderHook(() => useIsDesktop());
    rerender();
    rerender();
    expect(added).toHaveBeenCalledOnce();
    expect(result.current).toBe(false);
    act(() => {
      matches = true;
      for (const fn of listeners) fn();
    });
    expect(result.current).toBe(true);
  });
});
