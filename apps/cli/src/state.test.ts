import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test/temp';
import { DailyJobCounter, localDay } from './state';

describe('DailyJobCounter', () => {
  it('counts jobs and says no once the cap is reached', () => {
    const counter = new DailyJobCounter(tempDir(), () => new Date(2026, 9, 10, 9, 0));
    expect([counter.take(2), counter.take(2), counter.take(2)]).toEqual([true, true, false]);
  });

  it('starts again on the next local day', () => {
    let now = new Date(2026, 9, 10, 23, 59);
    const counter = new DailyJobCounter(tempDir(), () => now);
    expect(counter.take(1)).toBe(true);
    expect(counter.take(1)).toBe(false);
    now = new Date(2026, 9, 11, 0, 1);
    expect(counter.take(1)).toBe(true);
  });

  it('treats a missing or unreadable file as no jobs yet', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'state.json'), 'not json');
    expect(new DailyJobCounter(dir).take(1)).toBe(true);
    expect(localDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
