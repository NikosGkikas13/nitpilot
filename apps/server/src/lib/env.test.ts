import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnv, vapidDetails } from './env';

afterEach(() => vi.unstubAllEnvs());

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

  it('names every missing variable', () => {
    vi.stubEnv('GITHUB_CLIENT_ID', '');
    vi.stubEnv('PUBLIC_URL', 'not a url');
    expect(() => getEnv()).toThrow(/GITHUB_CLIENT_ID[\s\S]*PUBLIC_URL|PUBLIC_URL[\s\S]*GITHUB_CLIENT_ID/);
  });

  describe('Web Push keys', () => {
    const keys = { VAPID_PUBLIC_KEY: 'BPublic', VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: 'mailto:admin@example.com' };
    const stub = (values: Record<string, string>) => Object.entries(values).forEach(([name, value]) => vi.stubEnv(name, value));

    it('are optional: without them push is off', () => {
      expect(vapidDetails(getEnv())).toBeNull();
      // Left empty, as in a copied .env.example, counts as not set.
      stub({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' });
      expect(vapidDetails(getEnv())).toBeNull();
    });

    it('turn push on when all three are set, with a mailto: or https: subject', () => {
      stub(keys);
      expect(vapidDetails(getEnv())).toEqual({ publicKey: 'BPublic', privateKey: 'private', subject: 'mailto:admin@example.com' });
      vi.stubEnv('VAPID_SUBJECT', 'https://nitpilot.dev');
      expect(vapidDetails(getEnv())?.subject).toBe('https://nitpilot.dev');
    });

    it('are all or none', () => {
      stub({ VAPID_PUBLIC_KEY: keys.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: keys.VAPID_PRIVATE_KEY });
      expect(() => getEnv()).toThrow(/VAPID_SUBJECT: set all three of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT, or none/);
    });

    it('refuse a subject that is neither mailto: nor https:', () => {
      stub({ ...keys, VAPID_SUBJECT: 'admin@example.com' });
      expect(() => getEnv()).toThrow(/VAPID_SUBJECT/);
    });
  });
});
