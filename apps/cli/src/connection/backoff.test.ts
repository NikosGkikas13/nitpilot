import { describe, expect, it } from 'vitest';
import { Backoff } from './backoff';

const waits = (backoff: Backoff, n: number) => Array.from({ length: n }, () => backoff.next());

describe('Backoff', () => {
  it('waits 1 s, then doubles each time up to 30 s', () => {
    expect(waits(new Backoff({ random: () => 0.5 }), 7)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });

  it('spreads each wait by up to 20% either way, so CLIs reconnecting together drift apart', () => {
    expect(new Backoff({ random: () => 0 }).next()).toBe(800);
    expect(new Backoff({ random: () => 1 }).next()).toBe(1_200);
  });

  it('starts over from 1 s after a good connection', () => {
    const backoff = new Backoff({ random: () => 0.5 });
    waits(backoff, 4);
    backoff.reset();
    expect(backoff.next()).toBe(1_000);
  });
});
