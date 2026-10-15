import type { WebMe } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { requireUser, type UserVariables } from '../../auth/request-user';
import { prisma } from '../../lib/prisma';

/** `GET /api/me` (spec §10): who you are and whether your GitHub sign-in still works. For the web app and the CLI alike. */
export function meRoutes(): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();

  app.get('/api/me', requireUser, async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get('user').id }, include: { githubAuth: true } });
    const body: WebMe = {
      id: user.id,
      githubId: user.githubId,
      login: user.login,
      avatarUrl: user.avatarUrl,
      githubAuth: user.githubAuth?.status === 'ok' ? 'ok' : 'needs_reauth',
    };
    return c.json(body);
  });

  return app;
}
