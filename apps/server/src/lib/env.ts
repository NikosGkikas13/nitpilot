import { z } from 'zod';

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
});

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
