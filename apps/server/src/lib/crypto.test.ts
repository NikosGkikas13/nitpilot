import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto';

describe('encrypt / decrypt', () => {
  it('round-trips and uses a fresh IV every time', () => {
    const a = encrypt('gho_secret');
    const b = encrypt('gho_secret');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('gho_secret');
  });

  it('refuses tampered ciphertext', () => {
    const buf = Buffer.from(encrypt('gho_secret'), 'base64');
    buf[buf.length - 1] ^= 1;
    expect(() => decrypt(buf.toString('base64'))).toThrow();
  });
});
