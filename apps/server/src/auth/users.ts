import type { Settings, WebMe } from '@nitpilot/protocol';
import type { LiveClis } from '../chats/activity';
import { encrypt } from '../lib/crypto';
import { prisma } from '../lib/prisma';
import type { OAuthTokens } from './github-oauth';

/** Create or update the user after sign-in, and store their GitHub tokens encrypted. */
export async function saveGithubUser(gh: { githubId: string; login: string; avatarUrl: string | null }, tokens: OAuthTokens) {
  const user = await prisma.user.upsert({
    where: { githubId: gh.githubId },
    create: { githubId: gh.githubId, login: gh.login, avatarUrl: gh.avatarUrl },
    update: { login: gh.login, avatarUrl: gh.avatarUrl },
  });
  const secrets = {
    accessTokenEnc: encrypt(tokens.accessToken),
    accessExpiresAt: tokens.accessExpiresAt,
    refreshTokenEnc: encrypt(tokens.refreshToken),
    refreshExpiresAt: tokens.refreshExpiresAt,
    status: 'ok',
  };
  await prisma.githubAuth.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...secrets },
    update: { ...secrets, version: { increment: 1 } },
  });
  return user;
}

/** The `User` columns that hold a person's settings (spec §8), for a Prisma `select`. */
export const SETTINGS_COLUMNS = { autoReview: true, autoAddress: true, dailyJobCap: true } as const;

/** A person's settings, picked out of their `User` row. */
export function settingsOf(user: Settings): Settings {
  return { autoReview: user.autoReview, autoAddress: user.autoAddress, dailyJobCap: user.dailyJobCap };
}

/**
 * Who you are, as the web app reads it (`GET /api/me`, and `me.update` on `/ws/web`): your GitHub account, whether
 * your GitHub sign-in still works, whether one of your CLIs is connected right now, your settings, how many
 * agent runs your connected CLIs started today, and Web Push: the server's public key (null when push is off)
 * and whether you have a subscription. Last, whether you finished the setup checklist once (`User.onboardedAt`).
 */
export async function loadWebMe(userId: string, clis: LiveClis, vapidPublicKey: string | null): Promise<WebMe> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { githubAuth: true, _count: { select: { pushSubs: true } } } });
  const connected = clis.connectionsFor(user.id);
  return {
    id: user.id,
    githubId: user.githubId,
    login: user.login,
    avatarUrl: user.avatarUrl,
    githubAuth: user.githubAuth?.status === 'ok' ? 'ok' : 'needs_reauth',
    agentOnline: connected.length > 0,
    settings: settingsOf(user),
    // Each CLI counts from its own midnight; a device that's offline isn't counted.
    usedToday: connected.reduce((sum, cli) => sum + cli.usedToday, 0),
    push: { vapidPublicKey, subscribed: user._count.pushSubs > 0 },
    onboarded: user.onboardedAt !== null,
  };
}
