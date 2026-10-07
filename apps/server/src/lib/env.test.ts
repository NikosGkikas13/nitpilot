import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnv } from './env';

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
});
