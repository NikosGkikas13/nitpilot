import type { IncomingMessage } from 'node:http';
import {
  CliLoginPollRequest, CliLoginStartRequest,
  type Attention, type MyChat, type MyChatsResponse, type Phase, type Role,
} from '@nitpilot/protocol';
import { Hono, type Context } from 'hono';
import { LOGIN_TTL_MS, POLL_INTERVAL_SEC, pollCliLogin, startCliLogin } from '../../auth/cli-login';
import type { RepoAccess } from '../../auth/repo-access';
import { requireCliToken, type CliAuth } from '../../auth/cli-token';
import { rowsInReposYouCanRead } from '../../chats/repo-filter';
import { getEnv } from '../../lib/env';
import { prisma } from '../../lib/prisma';
import { RateLimiter } from '../../lib/rate-limit';
import { transcriptUrl } from '../../lib/urls';
import type { MeUpdates } from '../../ws/web-wire';
import { HttpError } from '../errors';

/** Each login start writes a row, so one address may start at most this many a minute (spec §14). */
export const LOGIN_STARTS_PER_MINUTE = 10;

/**
 * The CLI's routes: `nitpilot login` (spec §10 "CLI login"), its chats (only of repos `access` says you can read),
 * retry and logging out. `meUpdates` tells the person's open tabs when a login made a new token, so the setup
 * checklist's "Connect your computer" ticks at once.
 */
export function cliRoutes(deps: { access: RepoAccess; meUpdates?: MeUpdates }): Hono<{ Variables: { cli: CliAuth } }> {
  const app = new Hono<{ Variables: { cli: CliAuth } }>();
  const loginStarts = new RateLimiter(LOGIN_STARTS_PER_MINUTE, 60_000);

  app.post('/api/cli/login', async (c) => {
    if (!loginStarts.allow(clientAddress(c))) throw new HttpError('rate_limited', 'Too many logins started from here. Wait a minute and try again.');
    const { deviceName } = CliLoginStartRequest.parse(await c.req.json());
    const login = await startCliLogin(deviceName);
    return c.json({
      deviceCode: login.deviceCode,
      userCode: login.userCode,
      verifyUrl: `${getEnv().PUBLIC_URL}/cli/approve?code=${login.userCode}`,
      interval: POLL_INTERVAL_SEC,
      expiresIn: LOGIN_TTL_MS / 1000,
    });
  });

  app.post('/api/cli/login/poll', async (c) => {
    const { deviceCode } = CliLoginPollRequest.parse(await c.req.json());
    return c.json(await pollCliLogin(deviceCode, new Date(), (userId) => deps.meUpdates?.sendMeUpdate(userId)));
  });

  app.get('/api/me/chats', requireCliToken, async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get('cli').userId } });
    const rows = await prisma.participant.findMany({
      where: { githubId: user.githubId, chat: { closedAt: null } },
      include: { chat: { include: { repo: true } } },
      orderBy: { chat: { updatedAt: 'desc' } },
      take: 100,
    });
    const chats: MyChat[] = rows.map((p) => ({
      id: p.chat.id,
      repo: p.chat.repo.fullName,
      number: p.chat.number,
      title: p.chat.title,
      role: p.role as Role,
      phase: p.chat.phase as Phase,
      round: p.chat.round,
      attention: p.attention as Attention,
      url: transcriptUrl(p.chat.repo.fullName, p.chat.number),
      updatedAt: p.chat.updatedAt.toISOString(),
    }));
    // Each row shows the PR's title, so only repos you can still read on GitHub (the same check as the inbox).
    const body: MyChatsResponse = { chats: await rowsInReposYouCanRead(chats, user.id, deps.access) };
    return c.json(body);
  });

  app.delete('/api/cli/token', requireCliToken, async (c) => {
    await prisma.cliToken.update({ where: { id: c.get('cli').tokenId }, data: { revokedAt: new Date() } });
    return c.body(null, 204);
  });

  return app;
}

/**
 * The address a request came from: Hono's Node adapter puts the raw request in `c.env.incoming`.
 * Tests call the app without a socket ('unknown'). Behind a reverse proxy (Plan 3) this is the
 * proxy's address, until we read X-Forwarded-For from it.
 */
function clientAddress(c: Context): string {
  const incoming = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming;
  return incoming?.socket.remoteAddress ?? 'unknown';
}
