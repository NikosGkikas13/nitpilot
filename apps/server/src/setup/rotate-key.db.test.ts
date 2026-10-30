import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeUser } from '../../test/db';
import { decrypt, encrypt } from '../lib/crypto';
import { prisma } from '../lib/prisma';
import { reEncryptStoredSecrets } from './rotate-key';

const OLD = process.env.ENCRYPTION_KEY!; // test/test-env.ts: every row other tests left is on this key
const NEW = Buffer.alloc(32, 4).toString('base64');
const later = new Date(Date.now() + 3_600_000);

afterEach(() => vi.unstubAllEnvs());

describe('reEncryptStoredSecrets', () => {
  it('does nothing without ENCRYPTION_KEY_PREVIOUS', async () => {
    expect(await reEncryptStoredSecrets()).toBe(0);
  });

  it('moves tokens and the stored app onto the new key, leaves values already on it alone, and can go back', async () => {
    await prisma.githubAppConfig.deleteMany();
    const user = await makeUser();
    await prisma.githubAuth.create({
      data: { userId: user.id, accessTokenEnc: encrypt('ghu_a'), accessExpiresAt: later, refreshTokenEnc: encrypt('ghr_a'), refreshExpiresAt: later },
    });
    await prisma.githubAppConfig.create({
      data: { appId: '1', slug: 's', clientId: 'c', ownerLogin: 'o', privateKeyEnc: encrypt('pem'), clientSecretEnc: encrypt('cs'), webhookSecretEnc: encrypt('ws') },
    });

    vi.stubEnv('ENCRYPTION_KEY', NEW);
    vi.stubEnv('ENCRYPTION_KEY_PREVIOUS', OLD);
    const firstRun = await reEncryptStoredSecrets();
    expect(firstRun).toBeGreaterThanOrEqual(5);
    expect(await reEncryptStoredSecrets()).toBe(0); // everything is on the new key now

    // With the old key gone, the new key alone reads everything.
    vi.stubEnv('ENCRYPTION_KEY_PREVIOUS', '');
    const auth = await prisma.githubAuth.findUniqueOrThrow({ where: { userId: user.id } });
    const app = await prisma.githubAppConfig.findUniqueOrThrow({ where: { id: 'app' } });
    expect([decrypt(auth.accessTokenEnc), decrypt(auth.refreshTokenEnc)]).toEqual(['ghu_a', 'ghr_a']);
    expect([decrypt(app.privateKeyEnc), decrypt(app.clientSecretEnc), decrypt(app.webhookSecretEnc)]).toEqual(['pem', 'cs', 'ws']);

    // Rotate back, so the shared test database is on the test key again for the files after this one.
    vi.stubEnv('ENCRYPTION_KEY', OLD);
    vi.stubEnv('ENCRYPTION_KEY_PREVIOUS', NEW);
    expect(await reEncryptStoredSecrets()).toBe(firstRun);
    await prisma.githubAppConfig.deleteMany();
  });

  it('refuses, and changes nothing, when a value neither key reads is stored', async () => {
    const user = await makeUser();
    const good = encrypt('ghu_b');
    vi.stubEnv('ENCRYPTION_KEY', Buffer.alloc(32, 5).toString('base64'));
    const unreadable = encrypt('ghr_b');
    await prisma.githubAuth.create({
      data: { userId: user.id, accessTokenEnc: good, accessExpiresAt: later, refreshTokenEnc: unreadable, refreshExpiresAt: later },
    });

    vi.stubEnv('ENCRYPTION_KEY', NEW);
    vi.stubEnv('ENCRYPTION_KEY_PREVIOUS', OLD);
    await expect(reEncryptStoredSecrets()).rejects.toThrow();
    const auth = await prisma.githubAuth.findUniqueOrThrow({ where: { userId: user.id } });
    expect(auth.accessTokenEnc).toBe(good);
    await prisma.githubAuth.delete({ where: { userId: user.id } });
  });
});
