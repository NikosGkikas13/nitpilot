import type { IncomingMessage } from 'node:http';
import {
  BRAND, CliLoginPollRequest, CliLoginStartRequest,
  type Attention, type MeResponse, type MyChat, type MyChatsResponse, type Phase, type RetryResponse, type Role,
} from '@nitpilot/protocol';
import { Hono, type Context } from 'hono';
import { LOGIN_TTL_MS, POLL_INTERVAL_SEC, pollCliLogin, startCliLogin } from '../../auth/cli-login';
import { requireCliToken, type CliAuth } from '../../auth/cli-token';
import type { Dispatch } from '../../chats/dispatch';
import type { Person } from '../../engine/types';
import { getEnv } from '../../lib/env';
import { prisma } from '../../lib/prisma';
import { RateLimiter } from '../../lib/rate-limit';
import { transcriptUrl } from '../../lib/urls';
import { HttpError } from '../errors';

/** Each login start writes a row, so one address may start at most this many a minute (spec §14). */
export const LOGIN_STARTS_PER_MINUTE = 10;

export function cliRoutes(deps: { dispatch: Dispatch }): Hono<{ Variables: { cli: CliAuth } }> {
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
    return c.json(await pollCliLogin(deviceCode));
  });

  app.get('/api/me', requireCliToken, async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get('cli').userId }, include: { githubAuth: true } });
    const body: MeResponse = { login: user.login, avatarUrl: user.avatarUrl, githubAuth: user.githubAuth?.status === 'ok' ? 'ok' : 'needs_reauth' };
    return c.json(body);
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
    const body: MyChatsResponse = { chats };
    return c.json(body);
  });

  app.delete('/api/cli/token', requireCliToken, async (c) => {
    await prisma.cliToken.update({ where: { id: c.get('cli').tokenId }, data: { revokedAt: new Date() } });
    return c.body(null, 204);
  });

  // `nitpilot retry` (spec §10): run my failed job on this PR again. Plan 2's Retry button uses it too.
  app.post('/api/chats/:id/retry', requireCliToken, async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get('cli').userId } });
    const chatId = c.req.param('id');
    const failure = await failureKind(chatId, user.githubId);
    if (failure === null) throw new HttpError('conflict', 'Nothing of yours failed on this PR.');
    if (failure === 'github_post') {
      throw new HttpError(
        'conflict',
        `Your agent didn't fail on this PR: posting its review or replies to GitHub did, and running the agent again won't fix that. If \`${BRAND.cli} status\` says GitHub access expired, sign in again at ${getEnv().PUBLIC_URL}.`,
      );
    }
    const who: Person = { githubId: user.githubId, login: user.login, isBot: false, userId: user.id };
    const out = await deps.dispatch(chatId, { type: 'retry_requested', who });
    // The job is queued now.
    if (out.commands.some((cmd) => cmd.type === 'enqueue_job' && cmd.participant.githubId === user.githubId)) {
      const body: RetryResponse = { status: 'queued' };
      return c.json(body);
    }
    // The engine cleared the failure but the job can't start yet (the author's agent is fixing, or the PR is a draft).
    // It starts by itself once that step is done.
    if (!out.chat.participants.some((p) => p.githubId === user.githubId && p.attention === 'failed')) {
      const body: RetryResponse = { status: 'waiting' };
      return c.json(body);
    }
    // The engine changed nothing.
    throw new HttpError('conflict', "Nothing to retry: the PR is closed, or you're no longer a reviewer on it.");
  });

  return app;
}

/**
 * Why this person is flagged `failed` in the chat, if they are:
 * - null: none of their roles is flagged;
 * - 'agent': a flagged role's newest job failed, so running it again can help;
 * - 'github_post': otherwise. A write that never reached GitHub (spec §15, `write_failed`) is the only other
 *   thing that sets the flag, and it is fixed by signing in again, not by re-running the agent.
 */
async function failureKind(chatId: string, githubId: string): Promise<'agent' | 'github_post' | null> {
  const flagged = await prisma.participant.findMany({ where: { chatId, githubId, attention: 'failed' }, select: { id: true } });
  if (flagged.length === 0) return null;
  for (const p of flagged) {
    const newest = await prisma.job.findFirst({ where: { participantId: p.id }, orderBy: { createdAt: 'desc' }, select: { status: true } });
    if (newest?.status === 'failed') return 'agent';
  }
  return 'github_post';
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
