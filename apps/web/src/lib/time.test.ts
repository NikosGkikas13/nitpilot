import { describe, expect, it } from 'vitest';
import { rowTime } from './time';

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
