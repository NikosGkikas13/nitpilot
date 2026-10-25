import type { GithubAppConfig } from '../generated/prisma/client';
import { decrypt, encrypt } from '../lib/crypto';
import { getEnv, type Env } from '../lib/env';
import { isUniqueViolation, prisma } from '../lib/prisma';

/**
 * Everything the server needs to be a GitHub App (docs/why/github-app.md): who it is (`appId`, `slug`), how it proves
 * it (`privateKey`), how people sign in through it (`clientId`, `clientSecret`) and how it checks webhooks
 * (`webhookSecret`). It comes from the GITHUB_* variables, or from the app first-run mode created and stored
 * (docs/why/first-run-and-app-manifests.md).
 */
export type GithubAppCredentials = {
  appId: string;
  slug: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
};

/** The one row's id: a server has at most one app. */
const APP_ROW_ID = 'app';

/** A second app for a server that already has one (two first-run callbacks at once, or a replayed one). */
export class GithubAppExistsError extends Error {
  constructor() {
    super('This server already has a GitHub App.');
    this.name = 'GithubAppExistsError';
  }
}

/** The app in the environment, or null when its six variables aren't set (getEnv already refused a half-set app). */
export function credentialsFromEnv(env: Env): GithubAppCredentials | null {
  const { GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_WEBHOOK_SECRET } = env;
  if (!GITHUB_APP_ID || !GITHUB_APP_SLUG || !GITHUB_APP_PRIVATE_KEY || !GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_WEBHOOK_SECRET) return null;
  return {
    appId: GITHUB_APP_ID,
    slug: GITHUB_APP_SLUG,
    privateKey: GITHUB_APP_PRIVATE_KEY,
    clientId: GITHUB_CLIENT_ID,
    clientSecret: GITHUB_CLIENT_SECRET,
    webhookSecret: GITHUB_WEBHOOK_SECRET,
  };
}

/**
 * The stored app, decrypted. AES-GCM refuses to decrypt with any other key than the one that encrypted (lib/crypto.ts),
 * so a changed ENCRYPTION_KEY lands here. The server must not start then, and above all must not fall into first-run
 * mode and replace the row: the app still exists on GitHub, and only the old key can bring it back.
 */
function decryptRow(row: GithubAppConfig): GithubAppCredentials {
  try {
    return {
      appId: row.appId,
      slug: row.slug,
      clientId: row.clientId,
      privateKey: decrypt(row.privateKeyEnc),
      clientSecret: decrypt(row.clientSecretEnc),
      webhookSecret: decrypt(row.webhookSecretEnc),
    };
  } catch {
    throw new Error("The stored GitHub App can't be read with this ENCRYPTION_KEY. Put back the key it was made with.");
  }
}

/**
 * Which GitHub App this server is, at boot (main.ts): the environment's when its six variables are set (development
 * with `nitpilot-dev`, or anyone who made their app by hand), else the one first-run mode stored, else null, which
 * means first-run mode.
 */
export async function loadGithubApp(env: Env): Promise<{ source: 'env' | 'database'; creds: GithubAppCredentials } | null> {
  const fromEnv = credentialsFromEnv(env);
  if (fromEnv) return { source: 'env', creds: fromEnv };
  const row = await prisma.githubAppConfig.findUnique({ where: { id: APP_ROW_ID } });
  if (!row) return null;
  return { source: 'database', creds: decryptRow(row) };
}

/**
 * Store the app first-run mode just created. Insert only: the row's fixed id makes a second save a unique-constraint
 * error, so two callbacks racing can't both win and an existing app is never overwritten.
 */
export async function saveGithubApp(creds: GithubAppCredentials, ownerLogin: string): Promise<void> {
  try {
    await prisma.githubAppConfig.create({
      data: {
        id: APP_ROW_ID,
        appId: creds.appId,
        slug: creds.slug,
        clientId: creds.clientId,
        privateKeyEnc: encrypt(creds.privateKey),
        clientSecretEnc: encrypt(creds.clientSecret),
        webhookSecretEnc: encrypt(creds.webhookSecret),
        ownerLogin,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new GithubAppExistsError();
    throw err;
  }
}

// The app this process runs as, set once at boot. Like getEnv(), any file can ask for it without it being passed down
// through every function between main.ts and the one GitHub call that needs a secret.
let current: GithubAppCredentials | null = null;

/** Called once by main.ts with what loadGithubApp found. Tests pass null to forget it again. */
export function setGithubApp(creds: GithubAppCredentials | null): void {
  current = creds;
}

/**
 * The app this server runs as: what main.ts set at boot, else the environment's (tests and scripts, which never boot
 * the server). Throws in first-run mode; nothing that needs the app runs then (http/app.ts answers 503 first).
 */
export function githubApp(): GithubAppCredentials {
  if (current) return current;
  const fromEnv = credentialsFromEnv(getEnv());
  if (fromEnv) return fromEnv;
  throw new Error('No GitHub App yet: this server is in first-run mode.');
}
