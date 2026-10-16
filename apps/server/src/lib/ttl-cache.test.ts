import { describe, expect, it } from 'vitest';
import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('keeps a value for its time to live, then forgets it', () => {
    let now = 0;
    const cache = new TtlCache<string>(1_000, 10, () => now);
    cache.set('a', 'one');
    now = 999;
    expect(cache.get('a')).toBe('one');
    now = 1_000;
    expect(cache.get('a')).toBeUndefined();
  });

  it('drops the oldest entry once full, and setting a key again makes it the newest', () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 3);
    cache.set('c', 4);
    expect([cache.get('a'), cache.get('b'), cache.get('c')]).toEqual([3, undefined, 4]);
  });
});
