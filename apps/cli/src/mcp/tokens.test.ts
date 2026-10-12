import { describe, expect, it } from 'vitest';
import { JobTokens, newJobToken } from './tokens';

describe('newJobToken', () => {
  it('is 32 random bytes, URL-safe, never the same twice', () => {
    const tokens = new Set(Array.from({ length: 100 }, newJobToken));
    expect(tokens.size).toBe(100);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('JobTokens', () => {
  it('finds a job only by its exact bearer token, and not after it is removed', () => {
    const jobs = new JobTokens<string>();
    const token = newJobToken();
    jobs.add(token, 'job A');
    expect(jobs.find(`Bearer ${token}`)).toBe('job A');
    expect(jobs.find(undefined)).toBeNull();
    expect(jobs.find(token)).toBeNull(); // not a bearer header
    expect(jobs.find(`Bearer ${token.slice(0, -1)}`)).toBeNull(); // one character short
    expect(jobs.find(`Bearer ${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`)).toBeNull(); // one character wrong
    expect(jobs.find(`Bearer ${token} extra`)).toBeNull();
    jobs.remove(token);
    expect(jobs.find(`Bearer ${token}`)).toBeNull();
  });
});
