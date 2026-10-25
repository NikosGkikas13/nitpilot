import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The letters a setup code is made of: A–Z and 2–9 without the ones people mix up when they copy a code from a
 * terminal into a browser (0 and O, 1, I and L). 31 of them.
 */
export const SETUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const CODE_LENGTH = 8;

/**
 * The biggest multiple of 31 that fits in a byte (248). A byte below it, taken `% 31`, gives every letter exactly 8
 * chances; the 8 bytes from 248 to 255 would give the first 8 letters a 9th, so they're thrown away and a new byte is
 * drawn (this is called rejection sampling). Without it some letters would come up more often, which makes a code
 * slightly easier to guess.
 */
const FAIR_BYTES = 256 - (256 % SETUP_CODE_ALPHABET.length);

/**
 * A one-time setup code like `K7PX-3MQD`, printed in the server's log at boot in first-run mode (setup/boot.ts). Only
 * someone who can read the log (the server's owner) can type it into /first-run, so a stranger who finds a fresh
 * server first can't claim it. 31⁸ ≈ 850 billion codes, at 5 tries a minute per address. `random` is for tests.
 */
export function makeSetupCode(random: (size: number) => Buffer = randomBytes): string {
  let code = '';
  while (code.length < CODE_LENGTH) {
    for (const byte of random(16)) {
      if (byte >= FAIR_BYTES) continue;
      code += SETUP_CODE_ALPHABET[byte % SETUP_CODE_ALPHABET.length];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** What people type, as the code is stored: no spaces or dash, upper case. */
function normalize(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Does what someone typed match the code? Spaces, a dash and lower case don't matter. The letters are compared in
 * constant time (`timingSafeEqual`), so how long a wrong answer takes says nothing about how many letters were right
 * (docs/why/security-primitives.md). `timingSafeEqual` throws on buffers of different lengths, so those are a plain no
 * first: the length of the code is no secret, it's printed on the page.
 */
export function setupCodeMatches(input: string, code: string): boolean {
  const typed = Buffer.from(normalize(input), 'utf8');
  const expected = Buffer.from(normalize(code), 'utf8');
  if (typed.length !== expected.length) return false;
  return timingSafeEqual(typed, expected);
}
