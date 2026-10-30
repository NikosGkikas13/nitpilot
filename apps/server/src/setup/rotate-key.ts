import { reEncrypt } from '../lib/crypto';
import { prisma } from '../lib/prisma';

/**
 * Moves every stored secret onto ENCRYPTION_KEY, when ENCRYPTION_KEY_PREVIOUS is set (docs/why/key-rotation.md,
 * runbook in docs/hosting.md). Runs at boot, under the singleton lock and before anything else reads a token, so
 * nothing races it. One transaction: either every value moves or none does. A value neither key can read throws, the
 * transaction rolls back and the server refuses to start, so nothing is lost. Values already on the new key are left
 * alone, so it's safe to run on every boot. Returns how many values it rewrote.
 */
export async function reEncryptStoredSecrets(): Promise<number> {
  if (!process.env.ENCRYPTION_KEY_PREVIOUS?.trim()) return 0;

  return prisma.$transaction(
    async (tx) => {
      let rewritten = 0;
      // Counts the value if it needed rewriting, and returns what to store.
      const moved = (value: string) => {
        const next = reEncrypt(value);
        if (next === null) return value;
        rewritten += 1;
        return next;
      };

      for (const row of await tx.githubAuth.findMany()) {
        const before = rewritten;
        const data = { accessTokenEnc: moved(row.accessTokenEnc), refreshTokenEnc: moved(row.refreshTokenEnc) };
        if (rewritten > before) await tx.githubAuth.update({ where: { id: row.id }, data });
      }

      for (const row of await tx.githubAppConfig.findMany()) {
        const before = rewritten;
        const data = {
          privateKeyEnc: moved(row.privateKeyEnc),
          clientSecretEnc: moved(row.clientSecretEnc),
          webhookSecretEnc: moved(row.webhookSecretEnc),
        };
        if (rewritten > before) await tx.githubAppConfig.update({ where: { id: row.id }, data });
      }

      return rewritten;
    },
    { timeout: 60_000 },
  );
}
