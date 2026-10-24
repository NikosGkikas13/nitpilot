import { BRAND } from '@nitpilot/protocol';
import { createMiddleware } from 'hono/factory';
import { HttpError } from '../http/errors';
import { isAllowedOrigin } from '../lib/csrf';
import { getEnv } from '../lib/env';
import { prisma } from '../lib/prisma';
import { authenticateCliToken } from './cli-token';
import { currentUser, type SessionUser } from './session';

/** Who is asking, and how they proved it: the web app's session cookie, or a CLI's token. */
export type UserVariables = { user: SessionUser; via: 'session' | 'cli' };

/**
 * For routes both the web app and the CLI call (`/api/me`, retry). A request with an `Authorization` header
 * is a CLI and must carry a valid `Bearer nit_…` token; anything else must have a signed-in session cookie.
 */
export const requireUser = createMiddleware<{ Variables: UserVariables }>(async (c, next) => {
  const header = c.req.header('authorization');
  if (header) {
    const auth = await authenticateCliToken(header);
    if (!auth) throw new HttpError('unauthorized', `Missing or invalid CLI token. Run \`${BRAND.cli} login\`.`);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    c.set('user', { id: user.id, githubId: user.githubId, login: user.login, avatarUrl: user.avatarUrl });
    c.set('via', 'cli');
  } else {
    const user = await currentUser(c);
    if (!user) throw new HttpError('unauthorized', 'Sign in with GitHub first.');
    c.set('user', user);
    c.set('via', 'session');
  }
  await next();
});

/**
 * For routes only the web app may use, even though a CLI token is also a valid sign-in: approving a CLI login,
 * and Send / Discard / Auto on drafts (a person decides those, not their agent). A CLI-token request is answered
 * as if no one were signed in. Goes after `requireUser`, which says how the request proved who it is.
 */
export const requireSession = createMiddleware<{ Variables: UserVariables }>(async (c, next) => {
  if (c.get('via') !== 'session') throw new HttpError('unauthorized', 'Sign in with GitHub first.');
  await next();
});

/**
 * A browser sends our cookie with any request to us, even one another site's page started. So a change made
 * with the cookie must come from our own pages (spec §14). A CLI's token isn't sent by browsers on their own,
 * so CLI requests need no such check. Goes after `requireUser`. It fails closed: only a request `requireUser`
 * marked as a CLI-token request skips the check, so a route that forgot `requireUser` (or put this one first)
 * is checked rather than left open.
 */
export const requireSameOrigin = createMiddleware<{ Variables: UserVariables }>(async (c, next) => {
  const changes = c.req.method !== 'GET' && c.req.method !== 'HEAD';
  if (changes && c.get('via') !== 'cli' && !isAllowedOrigin(c.req.raw, getEnv().PUBLIC_URL)) {
    throw new HttpError('forbidden', 'Request did not come from Nitpilot.');
  }
  await next();
});
