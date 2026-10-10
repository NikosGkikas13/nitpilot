import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit';

describe('RateLimiter', () => {
  it('allows `limit` requests in the window and refuses the next one', () => {
    const limiter = new RateLimiter(10, 60_000, () => 0);
    for (let i = 0; i < 10; i++) expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(false);
  });

  it('counts each key on its own', () => {
    const limiter = new RateLimiter(1, 60_000, () => 0);
    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('5.6.7.8')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(false);
  });

  it('allows again once the oldest request is out of the window', () => {
    let now = 0;
    const limiter = new RateLimiter(1, 60_000, () => now);
    expect(limiter.allow('1.2.3.4')).toBe(true);
    now = 59_999;
    expect(limiter.allow('1.2.3.4')).toBe(false);
    now = 60_001;
    expect(limiter.allow('1.2.3.4')).toBe(true);
  });
});
