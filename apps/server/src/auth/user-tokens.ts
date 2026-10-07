import type { GithubAuth } from '../generated/prisma/client';
import { decrypt, encrypt } from '../lib/crypto';
import { getEnv } from '../lib/env';
import { prisma } from '../lib/prisma';
import { GithubError, type GithubClient } from '../platform/github/client';
import { refreshTokens, type OAuthTokens } from './github-oauth';

/** The user must sign in with GitHub again before Nitpilot can act as them. */
export class NeedsReauthError extends Error {
  constructor(readonly userId: string) {
    super(`GitHub sign-in expired for user ${userId}`);
    this.name = 'NeedsReauthError';
  }
}

/** Refresh a little early, so a token never expires halfway through a write. */
const REFRESH_MARGIN_MS = 5 * 60_000;

/** One refresh per user at a time: refresh tokens are single-use (spec §15). */
const inFlight = new Map<string, Promise<string>>();

export async function getUserToken(userId: string, github: GithubClient, now = new Date()): Promise<string> {
  const auth = await prisma.githubAuth.findUnique({ where: { userId } });
  if (!auth || auth.status !== 'ok') throw new NeedsReauthError(userId);
  if (auth.accessExpiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS) return decrypt(auth.accessTokenEnc);

  const running = inFlight.get(userId);
  if (running) return running;
  const refresh = refreshOnce(auth, github, now).finally(() => inFlight.delete(userId));
  inFlight.set(userId, refresh);
  return refresh;
}

async function refreshOnce(auth: GithubAuth, github: GithubClient, now: Date): Promise<string> {
  if (auth.refreshExpiresAt <= now) {
    await markNeedsReauth(auth.id);
    throw new NeedsReauthError(auth.userId);
  }

  const env = getEnv();
  let tokens: OAuthTokens;
  try {
    tokens = await refreshTokens(github, { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, refreshToken: decrypt(auth.refreshTokenEnc) }, now);
  } catch (err) {
    // GitHub answered and said no (e.g. bad_refresh_token): only a new sign-in fixes that.
    if (err instanceof GithubError && err.status < 500) {
      await markNeedsReauth(auth.id);
      throw new NeedsReauthError(auth.userId);
    }
    throw err; // network trouble or a GitHub outage: try again later
  }

  // Save only if nobody refreshed meanwhile (compare-and-swap on `version`).
  const { count } = await prisma.githubAuth.updateMany({
    where: { id: auth.id, version: auth.version },
    data: {
      accessTokenEnc: encrypt(tokens.accessToken),
      accessExpiresAt: tokens.accessExpiresAt,
      refreshTokenEnc: encrypt(tokens.refreshToken),
      refreshExpiresAt: tokens.refreshExpiresAt,
      version: { increment: 1 },
    },
  });
  if (count === 0) {
    const fresh = await prisma.githubAuth.findUniqueOrThrow({ where: { id: auth.id } });
    return decrypt(fresh.accessTokenEnc);
  }
  return tokens.accessToken;
}

async function markNeedsReauth(id: string): Promise<void> {
  await prisma.githubAuth.update({ where: { id }, data: { status: 'needs_reauth' } });
}
