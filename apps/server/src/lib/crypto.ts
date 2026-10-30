import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM for secrets at rest (GitHub tokens, the OAuth state cookie).
// Ported from Odyhook's src/lib/crypto.ts. Output: base64 of iv || tag || ciphertext.
//
// Key rotation (docs/why/key-rotation.md): with ENCRYPTION_KEY_PREVIOUS set, decrypt also accepts the old key, and
// setup/rotate-key.ts rewrites every stored value onto ENCRYPTION_KEY at boot. encrypt only ever uses ENCRYPTION_KEY.

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function keyFrom(name: 'ENCRYPTION_KEY' | 'ENCRYPTION_KEY_PREVIOUS'): Buffer | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes (got ${key.length}). Generate one with: openssl rand -base64 32`);
  return key;
}

function currentKey(): Buffer {
  const key = keyFrom('ENCRYPTION_KEY');
  if (!key) throw new Error('ENCRYPTION_KEY is not set');
  return key;
}

function decryptWith(key: Buffer, payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('ciphertext too short');
  const decipher = createDecipheriv(ALGO, key, buf.subarray(0, IV_LEN));
  decipher.setAuthTag(buf.subarray(IV_LEN, IV_LEN + TAG_LEN));
  return Buffer.concat([decipher.update(buf.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString('utf8');
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, currentKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/** Tries ENCRYPTION_KEY, then ENCRYPTION_KEY_PREVIOUS if set. Throws if neither key reads it (or it was tampered with). */
export function decrypt(payload: string): string {
  try {
    return decryptWith(currentKey(), payload);
  } catch (err) {
    const previous = keyFrom('ENCRYPTION_KEY_PREVIOUS');
    if (!previous) throw err;
    return decryptWith(previous, payload);
  }
}

/** The value encrypted again with ENCRYPTION_KEY, or null when it already is. Throws if neither key reads it. */
export function reEncrypt(payload: string): string | null {
  try {
    decryptWith(currentKey(), payload);
    return null;
  } catch {
    return encrypt(decrypt(payload));
  }
}
