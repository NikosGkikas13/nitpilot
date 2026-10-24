import { MarkReadRequest, type InboxResponse } from '@nitpilot/protocol';
import { Hono } from 'hono';
import type { RepoAccess } from '../../auth/repo-access';
import { requireSameOrigin, requireUser, type UserVariables } from '../../auth/request-user';
import type { LiveClis } from '../../chats/activity';
import { loadInboxRows } from '../../chats/inbox';
import { rowsInReposYouCanRead } from '../../chats/repo-filter';
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
