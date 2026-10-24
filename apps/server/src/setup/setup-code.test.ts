import { timingSafeEqual } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { makeSetupCode, SETUP_CODE_ALPHABET, setupCodeMatches } from './setup-code';

// The real timingSafeEqual, watched, so a test can see the comparison goes through it.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

describe('makeSetupCode', () => {
  it('makes XXXX-XXXX from an alphabet without look-alikes', () => {
    for (let i = 0; i < 200; i++) expect(makeSetupCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // No 0/O, 1/I/L: someone copies this from a terminal into a browser.
    for (const lookAlike of ['0', 'O', '1', 'I', 'L']) expect(SETUP_CODE_ALPHABET).not.toContain(lookAlike);
    expect(new Set(SETUP_CODE_ALPHABET).size).toBe(SETUP_CODE_ALPHABET.length);
  });

  it('is different every time', () => {
    const codes = new Set(Array.from({ length: 100 }, () => makeSetupCode()));
    expect(codes.size).toBe(100);
  });

  it('maps each random byte to one letter, skipping the bytes that would favour some letters', () => {
    // 31 letters don't divide 256: bytes 248 to 255 would give the first 8 letters a 9th chance each, so they're skipped.
    // Every other byte is byte % 31: 0 and 31 are both the first letter, 30 and 247 the last.
    const queue = [248, 0, 31, 255, 30, 247, 1, 32, 252, 62, 249, 250, 251, 253, 254, 33];
    const take = (n: number) => Buffer.from(queue.splice(0, n));
    const a = SETUP_CODE_ALPHABET;
    expect(a).toHaveLength(31);
    expect(makeSetupCode(take)).toBe(`${a[0]}${a[0]}${a[30]}${a[30]}-${a[1]}${a[1]}${a[0]}${a[2]}`);
  });
});

describe('setupCodeMatches', () => {
  const code = 'ABCD-EF23';

  it('accepts the code as printed, and as people type it', () => {
    for (const input of ['ABCD-EF23', 'abcd-ef23', '  ABCD-EF23 ', 'ABCDEF23', 'abcd ef23', 'AB CD-EF 23']) {
      expect(setupCodeMatches(input, code), input).toBe(true);
    }
  });

  it('refuses anything else without throwing, whatever its length', () => {
    for (const input of ['ABCD-EF24', 'ABCD-EF2', 'ABCD-EF233', '', '-', 'ÄBCD-EF23', 'ABCD_EF23']) {
      expect(setupCodeMatches(input, code), input).toBe(false);
    }
  });

  it('compares codes of the right length in constant time', () => {
    vi.mocked(timingSafeEqual).mockClear();
    expect(setupCodeMatches('ABCD-EF24', code)).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledOnce();
  });
});
