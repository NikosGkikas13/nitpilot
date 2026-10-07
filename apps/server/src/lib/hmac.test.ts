import { describe, expect, it } from 'vitest';
import { signGithubBody, verifyGithubSignature } from './hmac';

describe('verifyGithubSignature', () => {
  const body = '{"action":"opened"}';

  it('accepts the right signature', () => {
    expect(verifyGithubSignature(body, signGithubBody(body, 's3cret'), 's3cret')).toBe(true);
  });

  it.each([
    ['a wrong secret', signGithubBody(body, 'other')],
    ['a missing header', null],
    ['no sha256= prefix', signGithubBody(body, 's3cret').slice('sha256='.length)],
    ['same length but not hex', `sha256=${'z'.repeat(64)}`],
    ['a short signature', 'sha256=abcd'],
  ])('rejects %s', (_label, header) => {
    expect(verifyGithubSignature(body, header, 's3cret')).toBe(false);
  });

  it('rejects a body that changed by one byte', () => {
    expect(verifyGithubSignature(`${body} `, signGithubBody(body, 's3cret'), 's3cret')).toBe(false);
  });
});
