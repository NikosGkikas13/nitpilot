import type { WebMe } from '@nitpilot/protocol';
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

/**
 * Who you are, as the web app reads it (`GET /api/me`, and `me.update` on `/ws/web`): your GitHub account, whether
 * your GitHub sign-in still works, and whether one of your CLIs is connected right now.
 */
export async function loadWebMe(userId: string, clis: LiveClis): Promise<WebMe> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { githubAuth: true } });
  return {
    id: user.id,
    githubId: user.githubId,
    login: user.login,
    avatarUrl: user.avatarUrl,
    githubAuth: user.githubAuth?.status === 'ok' ? 'ok' : 'needs_reauth',
    agentOnline: clis.connectionsFor(user.id).length > 0,
  };
}
