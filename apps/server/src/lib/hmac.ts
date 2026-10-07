import { createHmac, timingSafeEqual } from 'node:crypto';

const HEX = /^[0-9a-f]+$/i;

/**
 * Check GitHub's X-Hub-Signature-256 against the raw body, in constant time.
 * Malformed input is a plain mismatch, never an exception (Odyhook's src/lib/hmac.ts).
 */
export function verifyGithubSignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const received = header.slice('sha256='.length);
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (received.length !== expected.length || !HEX.test(received)) return false;
  return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}

/** Sign a body the way GitHub does. Used by tests and dev tools. */
export function signGithubBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}
