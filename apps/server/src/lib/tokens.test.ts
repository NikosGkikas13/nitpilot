import { describe, expect, it } from 'vitest';
import { generateToken, generateUserCode, hashToken, parseBearer } from './tokens';

describe('tokens', () => {
  it('generates nit_ tokens and stores only a hash and a short prefix', () => {
    const t = generateToken();
    expect(t.raw).toMatch(/^nit_[A-Za-z0-9_-]{43}$/);
    expect(t.hash).toBe(hashToken(t.raw));
    expect(t.prefix).toBe(t.raw.slice(0, 8));
  });

  it('reads a bearer header', () => {
    expect(parseBearer('Bearer nit_abc')).toBe('nit_abc');
    expect(parseBearer('bearer nit_abc')).toBe('nit_abc');
    expect(parseBearer('Basic x')).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
  });

  it('makes user codes that are easy to read aloud', () => {
    for (let i = 0; i < 50; i++) expect(generateUserCode()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  });
});
