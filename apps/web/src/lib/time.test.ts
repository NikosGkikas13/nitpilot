import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { itemTime, rowTime, useNow } from './time';

// Local times, so the test reads the same in every time zone.
const now = new Date(2026, 9, 15, 18, 30); // Thursday 15 October 2026, 18:30
const at = (day: number, hour: number, minute: number, second = 0) => new Date(2026, 9, day, hour, minute, second).toISOString();

describe('rowTime (the time on an inbox row)', () => {
  it('says "now" for the last minute', () => {
    expect(rowTime(at(15, 18, 29, 30), now)).toBe('now');
  });

  it('shows the clock time earlier today', () => {
    expect(rowTime(at(15, 9, 5), now)).toBe('09:05');
    expect(rowTime(at(15, 16, 40), now)).toBe('16:40');
  });

  it('says "Yesterday", then the weekday for the last week, then the date', () => {
    expect(rowTime(at(14, 23, 59), now)).toBe('Yesterday');
    expect(rowTime(at(12, 10, 0), now)).toBe('Mon');
    expect(rowTime(at(3, 10, 0), now)).toBe('Oct 3');
  });
});

describe('itemTime (the time beside a timeline item)', () => {
  it('shows the clock time today, and the day before it for older items', () => {
    expect(itemTime(at(15, 16, 20), now)).toBe('16:20');
    expect(itemTime(at(14, 11, 18), now)).toBe('Yesterday 11:18');
    expect(itemTime(at(12, 9, 2), now)).toBe('Mon 09:02');
    expect(itemTime(at(3, 9, 2), now)).toBe('Oct 3 09:02');
  });
});

describe('useNow (the clock the inbox rows read)', () => {
  it('moves on every minute, so a row that said "now" says its time a minute later', () => {
    vi.useFakeTimers({ now });
    try {
      const { result } = renderHook(() => useNow());
      expect(rowTime(now.toISOString(), result.current)).toBe('now');
      act(() => vi.advanceTimersByTime(60_000));
      expect(rowTime(now.toISOString(), result.current)).toBe('18:30');
    } finally {
      vi.useRealTimers();
    }
  });
});
