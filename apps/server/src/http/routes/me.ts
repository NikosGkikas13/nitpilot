import type { WebMe } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { requireUser, type UserVariables } from '../../auth/request-user';
import type { LiveClis } from '../../chats/activity';
import { prisma } from '../../lib/prisma';

/**
 * `GET /api/me` (spec §10): who you are, whether your GitHub sign-in still works, and whether one of your CLIs
 * is connected. For the web app and the CLI alike.
 */
export function meRoutes(deps: { clis: LiveClis }): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();

  app.get('/api/me', requireUser, async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get('user').id }, include: { githubAuth: true } });
    const body: WebMe = {
      id: user.id,
      githubId: user.githubId,
      login: user.login,
      avatarUrl: user.avatarUrl,
      githubAuth: user.githubAuth?.status === 'ok' ? 'ok' : 'needs_reauth',
      agentOnline: deps.clis.connectionsFor(user.id).length > 0,
    };
    return c.json(body);
  });

  return app;
}
