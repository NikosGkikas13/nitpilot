import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEnv } from '../lib/env';
import { prisma } from '../lib/prisma';
import { githubApp, GithubAppExistsError, loadGithubApp, saveGithubApp, setGithubApp, type GithubAppCredentials } from './credentials';

const STORED: GithubAppCredentials = {
  appId: '777',
  slug: 'nitpilot-selfhost',
  privateKey: '-----BEGIN RSA PRIVATE KEY-----\nstored\n-----END RSA PRIVATE KEY-----\n',
  clientId: 'Iv23.stored',
  clientSecret: 'stored-client-secret',
  webhookSecret: 'stored-webhook-secret',
};

/** The app TEST_ENV describes (test/test-env.ts). */
const FROM_ENV: GithubAppCredentials = {
  appId: '12345',
  slug: 'nitpilot-dev',
  privateKey: 'tests-that-need-a-key-generate-one',
  clientId: 'Iv1.test',
  clientSecret: 'test-client-secret',
  webhookSecret: 'test-webhook-secret',
};

/** No GitHub App in the environment, as on a fresh self-hosted server. */
function clearGithubEnv() {
  for (const name of ['GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_WEBHOOK_SECRET']) {
    vi.stubEnv(name, '');
  }
}

beforeEach(async () => {
  await prisma.githubAppConfig.deleteMany();
});

afterEach(() => {
  vi.unstubAllEnvs();
  setGithubApp(null);
});

describe('saveGithubApp', () => {
  it('stores one row, with the private key and both secrets encrypted', async () => {
    await saveGithubApp(STORED, 'maya');
    const row = await prisma.githubAppConfig.findUniqueOrThrow({ where: { id: 'app' } });
    expect(row).toMatchObject({ appId: '777', slug: 'nitpilot-selfhost', clientId: 'Iv23.stored', ownerLogin: 'maya' });
    expect(row.privateKeyEnc).not.toContain('stored');
    expect(row.clientSecretEnc).not.toBe(STORED.clientSecret);
    expect(row.webhookSecretEnc).not.toBe(STORED.webhookSecret);
  });

  it('refuses a second app: one per server, and the first is never overwritten', async () => {
    await saveGithubApp(STORED, 'maya');
    await expect(saveGithubApp({ ...STORED, appId: '888' }, 'mallory')).rejects.toThrow(GithubAppExistsError);
    expect(await prisma.githubAppConfig.findMany()).toEqual([expect.objectContaining({ appId: '777', ownerLogin: 'maya' })]);
  });
});

describe('loadGithubApp', () => {
  it('takes the app from the environment when all six variables are set, even with one stored', async () => {
    await saveGithubApp(STORED, 'maya');
    expect(await loadGithubApp(getEnv())).toEqual({ source: 'env', creds: FROM_ENV });
  });

  it('reads the stored app when the environment has none', async () => {
    clearGithubEnv();
    await saveGithubApp(STORED, 'maya');
    expect(await loadGithubApp(getEnv())).toEqual({ source: 'database', creds: STORED });
  });

  it("refuses a stored app that this ENCRYPTION_KEY can't read, and leaves it as it was", async () => {
    clearGithubEnv();
    await saveGithubApp(STORED, 'maya');
    const before = await prisma.githubAppConfig.findUniqueOrThrow({ where: { id: 'app' } });

    vi.stubEnv('ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'));
    await expect(loadGithubApp(getEnv())).rejects.toThrow(
      "The stored GitHub App can't be read with this ENCRYPTION_KEY. Put back the key it was made with.",
    );
    expect(await prisma.githubAppConfig.findUniqueOrThrow({ where: { id: 'app' } })).toEqual(before);
  });

  it('finds nothing on a fresh server: first-run mode', async () => {
    clearGithubEnv();
    expect(await loadGithubApp(getEnv())).toBeNull();
  });
});

describe('githubApp', () => {
  it('answers with the app the server started with', () => {
    setGithubApp(STORED);
    expect(githubApp()).toEqual(STORED);
  });

  it('falls back to the environment (tests and scripts that never boot the server)', () => {
    expect(githubApp()).toEqual(FROM_ENV);
  });

  it('throws in first-run mode, when there is no app at all', () => {
    clearGithubEnv();
    expect(() => githubApp()).toThrow('No GitHub App yet: this server is in first-run mode.');
  });
});
