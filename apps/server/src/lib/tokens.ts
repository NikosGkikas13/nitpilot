import { createHash, randomBytes, randomInt } from 'node:crypto';
import { BRAND } from '@nitpilot/protocol';

export type GeneratedToken = { raw: string; hash: string; prefix: string };

/** sha256 hex of a raw token. The only form we store. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** A new CLI token. `raw` is shown to the CLI once and never stored. */
export function generateToken(): GeneratedToken {
  const raw = BRAND.tokenPrefix + randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw), prefix: raw.slice(0, BRAND.tokenPrefix.length + 4) };
}

export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m ? m[1]! : null;
}

/** A random URL-safe secret: session tokens, device codes, PKCE verifiers. */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// No vowels (no accidental words) and no lookalike characters.
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

/** The code a person compares between terminal and browser, e.g. WDJB-MJHT. */
export function generateUserCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
