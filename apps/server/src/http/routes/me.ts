import type { WebMe } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { requireUser, type UserVariables } from '../../auth/request-user';
import { loadWebMe } from '../../auth/users';
import type { LiveClis } from '../../chats/activity';

/**
 * `GET /api/me` (spec §10): who you are, whether your GitHub sign-in still works, and whether one of your CLIs
 * is connected. For the web app and the CLI alike. `vapidPublicKey` is the server's Web Push key, or null when push is off.
 */
export function meRoutes(deps: { clis: LiveClis; vapidPublicKey: string | null }): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();

  app.get('/api/me', requireUser, async (c) => {
    const body: WebMe = await loadWebMe(c.get('user').id, deps.clis, deps.vapidPublicKey);
    return c.json(body);
  });

  return app;
}
