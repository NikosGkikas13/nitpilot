import { describe, expect, it } from 'vitest';
import { ghId } from './db';

describe('ghId', () => {
  it('makes ids that survive a trip through a JSON number, like real GitHub ids', () => {
    for (let i = 0; i < 1000; i++) {
      const id = ghId();
      expect(String(JSON.parse(JSON.stringify(Number(id))))).toBe(id);
    }
  });

  it('never repeats', () => {
    const ids = Array.from({ length: 1000 }, () => ghId());
    expect(new Set(ids).size).toBe(ids.length);
  });
});
