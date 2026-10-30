import { afterEach, describe, expect, it, vi } from 'vitest';
import { decrypt, encrypt, reEncrypt } from './crypto';

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

describe('with ENCRYPTION_KEY_PREVIOUS (key rotation)', () => {
  const OLD = Buffer.alloc(32, 1).toString('base64');
  const NEW = Buffer.alloc(32, 2).toString('base64');
  afterEach(() => vi.unstubAllEnvs());

  it('reads values from the old key, writes only with the new one, and re-encrypts only what is on the old key', () => {
    vi.stubEnv('ENCRYPTION_KEY', OLD);
    const onOld = encrypt('gho_secret');

    vi.stubEnv('ENCRYPTION_KEY', NEW);
    expect(() => decrypt(onOld)).toThrow();
    vi.stubEnv('ENCRYPTION_KEY_PREVIOUS', OLD);
    expect(decrypt(onOld)).toBe('gho_secret');

    const moved = reEncrypt(onOld)!;
    expect(moved).not.toBeNull();
    expect(reEncrypt(moved)).toBeNull();
    vi.stubEnv('ENCRYPTION_KEY_PREVIOUS', '');
    expect(decrypt(moved)).toBe('gho_secret');
  });

  it('still refuses a value neither key reads', () => {
    vi.stubEnv('ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'));
    const onOther = encrypt('gho_secret');
    vi.stubEnv('ENCRYPTION_KEY', NEW);
    vi.stubEnv('ENCRYPTION_KEY_PREVIOUS', OLD);
    expect(() => decrypt(onOther)).toThrow();
    expect(() => reEncrypt(onOther)).toThrow();
  });
});
