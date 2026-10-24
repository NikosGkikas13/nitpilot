import { BRAND, MarkReadRequest, type InboxResponse } from '@nitpilot/protocol';
import { Hono } from 'hono';
import type { RepoAccess, RepoAccessResult } from '../../auth/repo-access';
import { requireSameOrigin, requireUser, type UserVariables } from '../../auth/request-user';
import type { LiveClis } from '../../chats/activity';
import { loadInboxRows } from '../../chats/inbox';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../errors';

/** `GET /api/inbox` and `POST /api/chats/:id/read` (spec §10 "REST endpoints in Plan 2"). */
export function inboxRoutes(deps: { clis: LiveClis; access: RepoAccess }): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();
  const { access } = deps;

  app.get('/api/inbox', requireUser, async (c) => {
    const user = c.get('user');
    const rows = await loadInboxRows(user, deps.clis);
    const body: InboxResponse = { rows: await rowsInReposYouCanRead(rows, user.id, access) };
    return c.json(body);
  });

  // You've read the chat up to `seq`. Only someone in the chat has a cursor; for anyone else the chat
  // doesn't exist, like everywhere else (spec §16).
  app.post('/api/chats/:id/read', requireUser, requireSameOrigin, async (c) => {
    const { seq } = MarkReadRequest.parse(await c.req.json());
    const user = c.get('user');
    const chat = await prisma.prChat.findFirst({ where: { id: c.req.param('id'), participants: { some: { githubId: user.githubId } } } });
    if (!chat) throw new HttpError('not_found', 'No such chat.');
    // Never past the newest item: items that arrive later must count as unread.
    const upTo = Math.min(seq, chat.lastSeq);
    const key = { userId: user.id, chatId: chat.id };
    // Two tabs can mark the same chat at the same moment, and both try to create the row. skipDuplicates makes it
    // INSERT … ON CONFLICT DO NOTHING: the unique (userId, chatId) keeps one row, and the second insert does nothing
    // instead of failing (a failed insert would log an ERROR in Postgres). Then the cursor only moves forward.
    await prisma.chatRead.createMany({ data: [{ ...key, lastReadSeq: upTo }], skipDuplicates: true });
    await prisma.chatRead.updateMany({ where: { ...key, lastReadSeq: { lt: upTo } }, data: { lastReadSeq: upTo } });
    return c.body(null, 204);
  });

  return app;
}

/**
 * Each row (the inbox's, and the CLI's chat list) shows the PR's title, so a row is only for someone who can still read
 * its repo on GitHub, checked with their own token (spec §14, §16). `RepoAccess` keeps each answer for 5
 * minutes, and each repo is asked about once however many rows it has.
 */
export async function rowsInReposYouCanRead<T extends { repo: string }>(rows: T[], userId: string, access: RepoAccess): Promise<T[]> {
  const repos = [...new Set(rows.map((r) => r.repo))];
  let answers: RepoAccessResult[];
  try {
    answers = await Promise.all(repos.map((repo) => access.check(userId, repo)));
  } catch (err) {
    // GitHub is down, or rate limiting us: say so, rather than a bare 500.
    console.error('[repo access] could not check repo access:', err);
    throw new HttpError('github_unavailable', "GitHub didn't answer. Try again in a minute.");
  }
  if (answers.includes('reauth')) throw new HttpError('reauth', `Your GitHub sign-in expired, so ${BRAND.name} can't check which repos you can see. Sign in again.`);
  const readable = new Set(repos.filter((_, i) => answers[i] === 'read'));
  return rows.filter((r) => readable.has(r.repo));
}
