import webpush from 'web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnv, vapidDetails } from './env';

afterEach(() => vi.unstubAllEnvs());

/**
 * A real VAPID key pair, made the way `npm run vapid:keys` makes one: P-256, public key uncompressed, both base64url,
 * the private key always 32 bytes. (Node's `createECDH().getPrivateKey()` drops a leading zero byte, about one key in
 * 256, and the server rightly refuses a 31-byte key: that made this file fail now and then.)
 */
function makeKeyPair() {
  return webpush.generateVAPIDKeys();
}
const pair = makeKeyPair();

/** A pair whose private key starts with a zero byte (`AA…` in base64url), written out in full as web-push makes it. */
const LEADING_ZERO = {
  publicKey: 'BLmuHbGwGubCWsg20vhXJYV2i85rIPGXUwmYuZXwlZHh_pxHE744lZbuk45bbKp-1z5J1OJlQMq0n70ejMeyKQY',
  privateKey: 'AAg4Z59vqJAxyx-IR91D0aH0EXXfoLk7eJcF_8wZlvw',
};

describe('getEnv', () => {
  it('reads the test environment', () => {
    const env = getEnv();
    expect(env.PORT).toBe(8787);
    expect(env.PUBLIC_REPOS_ONLY).toBe(false);
    expect(env.ALLOWED_LOGINS).toEqual([]);
  });

  it('turns escaped newlines in the app private key into real ones', () => {
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '-----BEGIN KEY-----\\nabc\\n-----END KEY-----');
    expect(getEnv().GITHUB_APP_PRIVATE_KEY).toBe('-----BEGIN KEY-----\nabc\n-----END KEY-----');
  });

  it('parses flags and lists', () => {
    vi.stubEnv('PUBLIC_REPOS_ONLY', 'true');
    vi.stubEnv('ALLOWED_LOGINS', ' Maya , leo ');
    expect(getEnv()).toMatchObject({ PUBLIC_REPOS_ONLY: true, ALLOWED_LOGINS: ['maya', 'leo'] });
  });

  it('reads TRUST_PROXY and CLOSED_CHAT_RETENTION_DAYS', () => {
    expect(getEnv().TRUST_PROXY).toBe(false);
    expect(getEnv().CLOSED_CHAT_RETENTION_DAYS).toBeUndefined();
    vi.stubEnv('TRUST_PROXY', 'true');
    vi.stubEnv('CLOSED_CHAT_RETENTION_DAYS', '90');
    expect(getEnv()).toMatchObject({ TRUST_PROXY: true, CLOSED_CHAT_RETENTION_DAYS: 90 });
    // Left empty, as in a copied .env.example, counts as not set.
    vi.stubEnv('CLOSED_CHAT_RETENTION_DAYS', '');
    expect(getEnv().CLOSED_CHAT_RETENTION_DAYS).toBeUndefined();
    vi.stubEnv('CLOSED_CHAT_RETENTION_DAYS', '0');
    expect(() => getEnv()).toThrow(/CLOSED_CHAT_RETENTION_DAYS/);
  });

  it('names every missing variable', () => {
    vi.stubEnv('GITHUB_CLIENT_ID', '');
    vi.stubEnv('PUBLIC_URL', 'not a url');
    expect(() => getEnv()).toThrow(/GITHUB_CLIENT_ID[\s\S]*PUBLIC_URL|PUBLIC_URL[\s\S]*GITHUB_CLIENT_ID/);
  });

  describe('GitHub App variables', () => {
    const SIX = ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_WEBHOOK_SECRET'];

    it('are optional: with none set the server starts in first-run mode', () => {
      // Left empty, as in a copied .env.example, counts as not set.
      for (const name of SIX) vi.stubEnv(name, '');
      expect(getEnv()).toMatchObject({ GITHUB_APP_ID: undefined, GITHUB_APP_PRIVATE_KEY: undefined, GITHUB_WEBHOOK_SECRET: undefined });
    });

    it('are all or none: half set refuses to start and names the missing ones', () => {
      vi.stubEnv('GITHUB_CLIENT_SECRET', '');
      vi.stubEnv('GITHUB_WEBHOOK_SECRET', ' ');
      expect(() => getEnv()).toThrow(
        'set all six GitHub App variables, or none to start in first-run mode; missing: GITHUB_CLIENT_SECRET, GITHUB_WEBHOOK_SECRET',
      );
    });

    it('the error also points Docker installs at docs/self-hosting.md', () => {
      vi.stubEnv('GITHUB_CLIENT_SECRET', '');
      expect(() => getEnv()).toThrow('docs/self-hosting.md');
    });
  });

  describe('Web Push keys', () => {
    const keys = { VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY: pair.privateKey, VAPID_SUBJECT: 'mailto:admin@example.com' };
    const stub = (values: Record<string, string>) => Object.entries(values).forEach(([name, value]) => vi.stubEnv(name, value));

    it('are optional: without them push is off', () => {
      expect(vapidDetails(getEnv())).toBeNull();
      // Left empty, as in a copied .env.example, counts as not set.
      stub({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' });
      expect(vapidDetails(getEnv())).toBeNull();
    });

    it('turn push on when all three are set, with a mailto: or https: subject', () => {
      stub(keys);
      expect(vapidDetails(getEnv())).toEqual({ publicKey: pair.publicKey, privateKey: pair.privateKey, subject: 'mailto:admin@example.com' });
      vi.stubEnv('VAPID_SUBJECT', 'https://nitpilot.dev');
      expect(vapidDetails(getEnv())?.subject).toBe('https://nitpilot.dev');
    });

    it('are all or none', () => {
      stub({ VAPID_PUBLIC_KEY: keys.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: keys.VAPID_PRIVATE_KEY });
      expect(() => getEnv()).toThrow(/VAPID_SUBJECT: set all three of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT, or none/);
    });

    // A bad key would make every send fail on our side (web-push only checks the keys inside sendNotification), so the
    // server refuses to start instead.
    const NOT_A_PAIR = /VAPID_PUBLIC_KEY: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY aren't one key pair \(npm run vapid:keys makes a pair\)/;

    it("refuse a private key with one character mistyped", () => {
      // A middle character: the last one of a base64url key carries bits that decoding ignores.
      const typo = pair.privateKey[10] === 'A' ? 'B' : 'A';
      stub({ ...keys, VAPID_PRIVATE_KEY: pair.privateKey.slice(0, 10) + typo + pair.privateKey.slice(11) });
      expect(() => getEnv()).toThrow(NOT_A_PAIR);
    });

    it('refuse a public key from another pair, and keys that are not keys at all', () => {
      stub({ ...keys, VAPID_PUBLIC_KEY: makeKeyPair().publicKey });
      expect(() => getEnv()).toThrow(NOT_A_PAIR);
      stub({ ...keys, VAPID_PUBLIC_KEY: 'BPublic', VAPID_PRIVATE_KEY: 'private' });
      expect(() => getEnv()).toThrow(NOT_A_PAIR);
    });

    it('accept a private key that starts with a zero byte, written out to its full 32 bytes', () => {
      stub({ ...keys, VAPID_PUBLIC_KEY: LEADING_ZERO.publicKey, VAPID_PRIVATE_KEY: LEADING_ZERO.privateKey });
      expect(vapidDetails(getEnv())).toEqual({ ...LEADING_ZERO, subject: 'mailto:admin@example.com' });
    });

    it('refuse that key with its zero byte dropped (31 bytes): web-push signs only with 32', () => {
      const short = Buffer.from(LEADING_ZERO.privateKey, 'base64url').subarray(1).toString('base64url');
      stub({ ...keys, VAPID_PUBLIC_KEY: LEADING_ZERO.publicKey, VAPID_PRIVATE_KEY: short });
      expect(() => getEnv()).toThrow(NOT_A_PAIR);
    });

    it('refuse a subject that is neither mailto: nor https:', () => {
      stub({ ...keys, VAPID_SUBJECT: 'admin@example.com' });
      expect(() => getEnv()).toThrow(/VAPID_SUBJECT/);
    });
  });
});
