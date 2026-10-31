import type { StatsDays, StatsResponse, WebMe } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser, type UserVariables } from '../../auth/request-user';
import { loadWebMe } from '../../auth/users';
import type { LiveClis } from '../../chats/activity';
import { loadStats } from '../../chats/stats';

/** `?days=7` or `?days=30`, 7 when left out. Anything else is a 400. */
const StatsQuery = z.object({ days: z.enum(['7', '30']).default('7').transform((d): StatsDays => (d === '30' ? 30 : 7)) });

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

  app.get('/api/me/stats', requireUser, async (c) => {
    const { days } = StatsQuery.parse(c.req.query());
    const body: StatsResponse = await loadStats(c.get('user'), days);
    return c.json(body);
  });

  return app;
}
