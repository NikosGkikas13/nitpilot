import { createECDH } from 'node:crypto';
import { z } from 'zod';

/** An optional value: left empty (`NAME=` in .env) counts as not set. */
const optionalText = z.string().optional().transform((value) => value?.trim() || undefined);

/**
 * Is this public key the private key's own? A bad key would make every send fail on our side (web-push only checks the
 * keys inside `sendNotification`), so the server refuses to start with one instead of failing at the first notification.
 */
function isVapidKeyPair(publicKey: string, privateKey: string): boolean {
  const privateBytes = Buffer.from(privateKey, 'base64url');
  if (privateBytes.length !== 32 || Buffer.from(publicKey, 'base64url').length !== 65) return false;
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(privateBytes);
    return ecdh.getPublicKey('base64url') === publicKey;
  } catch {
    return false;
  }
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  /** Where people reach this server, e.g. https://nitpilot.dev. Used for links and OAuth. */
  PUBLIC_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  /** base64 of 32 random bytes: `openssl rand -base64 32` */
  ENCRYPTION_KEY: z.string().min(1),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_SLUG: z.string().min(1),
  /** The app's private key (PEM). `\n` escapes are allowed so it fits on one line. */
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).transform((k) => k.replaceAll('\\n', '\n')),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  /** Where the built web app is (apps/web/dist by default; see http/spa.ts). */
  WEB_DIST_DIR: z.string().min(1).optional(),
  /** Hosted instance: ignore private repos (spec §14.9). */
  PUBLIC_REPOS_ONLY: z.stringbool().default(false),
  /** Optional beta gate: comma-separated GitHub logins allowed to sign in. Empty = everyone. */
  ALLOWED_LOGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((l) => l.trim().toLowerCase()).filter(Boolean)),
  /**
   * Web Push (spec §16, docs/why/web-push.md): the server's VAPID key pair, made once with `npm run vapid:keys`, and a
   * contact for the push services (`mailto:` or `https:`). Optional, but all three or none: without them push is off
   * and every notification goes to the CLI, as in Plan 1.
   */
  VAPID_PUBLIC_KEY: optionalText,
  VAPID_PRIVATE_KEY: optionalText,
  VAPID_SUBJECT: optionalText.refine((s) => s === undefined || /^(mailto|https):/.test(s), 'must start with mailto: or https:'),
}).refine(
  (env) => {
    const set = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT].filter(Boolean).length;
    return set === 0 || set === 3;
  },
  { path: ['VAPID_SUBJECT'], message: 'set all three of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT, or none (npm run vapid:keys makes a key pair)' },
).refine(
  (env) => !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT || isVapidKeyPair(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY),
  { path: ['VAPID_PUBLIC_KEY'], message: "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY aren't one key pair (npm run vapid:keys makes a pair)" },
);

export type Env = z.infer<typeof EnvSchema>;

/** Read and check the environment. Throws one error naming every bad variable. */
export function getEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment:\n  ${problems}\nSee apps/server/.env.example.`);
  }
  return parsed.data;
}

/** What web-push signs with (spec §16): the key pair and the contact the push services see. */
export type VapidDetails = { subject: string; publicKey: string; privateKey: string };

/** The VAPID details, or null when the server has none: then push is off. */
export function vapidDetails(env: Env): VapidDetails | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
}
