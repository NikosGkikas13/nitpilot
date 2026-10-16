import type { ChatResponse, FilesResponse, MessagesResponse } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { z } from 'zod';
import { RepoAccess } from '../../auth/repo-access';
import { requireUser, type UserVariables } from '../../auth/request-user';
import { chatAccess, chatAccessByPath, type ChatAccess } from '../../chats/access';
import type { LiveClis } from '../../chats/activity';
import { repoRef } from '../../chats/rules';
import { loadItemsBefore } from '../../chats/timeline';
import { loadChatPage } from '../../chats/views';
import { prisma } from '../../lib/prisma';
import { TtlCache } from '../../lib/ttl-cache';
import { GithubError, type GithubClient } from '../../platform/github/client';
import type { PlatformReads } from '../../platform/types';
import { HttpError } from '../errors';

/** A PR's file list is kept this long per head commit: a push makes a new list. */
export const FILES_TTL_MS = 10 * 60_000;
/** The most file lists kept at once. */
export const MAX_FILE_LISTS = 500;

const BeforeQuery = z.object({ before: z.coerce.number().int().positive().optional() });

/**
 * The chat screen's reads (spec §10 "REST endpoints in Plan 2"): the chat, older timeline items, and the PR's
 * changed files. Each one first asks whether you can read the chat (chats/access.ts, docs/why/chat-access-rules.md).
 */
export function chatRoutes(deps: { github: GithubClient; platform: PlatformReads; clis: LiveClis }): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();
  const access = new RepoAccess(deps.github);
  const fileLists = new TtlCache<FilesResponse>(FILES_TTL_MS, MAX_FILE_LISTS);

  app.get('/api/chats/:owner/:repo/:number', requireUser, async (c) => {
    const user = c.get('user');
    const chat = readable(await askingGithub(() => chatAccessByPath(user, { owner: c.req.param('owner'), repo: c.req.param('repo'), number: c.req.param('number') }, access)));
    const body: ChatResponse = await loadChatPage(chat.id, user, deps.clis);
    return c.json(body);
  });

  app.get('/api/chats/:id/messages', requireUser, async (c) => {
    const { before } = BeforeQuery.parse(c.req.query());
    const chat = readable(await askingGithub(() => chatAccess(c.get('user'), c.req.param('id'), access)));
    const body: MessagesResponse = await loadItemsBefore(chat.id, before ?? null);
    return c.json(body);
  });

  app.get('/api/chats/:id/files', requireUser, async (c) => {
    const { id } = readable(await askingGithub(() => chatAccess(c.get('user'), c.req.param('id'), access)));
    const chat = await prisma.prChat.findUniqueOrThrow({ where: { id }, include: { repo: true } });
    const key = `${chat.id} ${chat.headSha}`;
    let body = fileLists.get(key);
    if (!body) {
      const { files, truncated } = await askingGithub(() => deps.platform.listPrFiles({ ...repoRef(chat.repo), number: chat.number }));
      body = { files, adds: files.reduce((n, f) => n + f.adds, 0), dels: files.reduce((n, f) => n + f.dels, 0), truncated };
      fileLists.set(key, body);
    }
    return c.json(body);
  });

  return app;
}

/** The chat you may read, or the answer for one you can't: the same 404 for "no such chat" and "not yours to see". */
function readable(access: ChatAccess): { id: string; repoFullName: string } {
  if (access.kind === 'reauth') throw new HttpError('reauth', 'Sign in with GitHub again to see this chat.');
  if (access.kind === 'none') throw new HttpError('not_found', 'No such chat.');
  return access.chat;
}

/** GitHub down, slow or rate limiting us is a 502 that says so, not a bare 500. */
async function askingGithub<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof GithubError)) throw err;
    console.error('[chats] GitHub did not answer:', err.message);
    throw new HttpError('github_unavailable', "GitHub didn't answer. Try again in a minute.");
  }
}
