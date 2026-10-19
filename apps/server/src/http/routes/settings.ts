import { Settings } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { requireSameOrigin, requireUser, type UserVariables } from '../../auth/request-user';
import { SETTINGS_COLUMNS, settingsOf } from '../../auth/users';
import { prisma } from '../../lib/prisma';
import type { MeUpdates } from '../../ws/web-wire';
import { HttpError } from '../errors';

/** Where new settings go once they're saved: the person's connected CLIs (the CLI hub, ws/cli-hub.ts). */
export type SettingsSender = { sendSettings(userId: string, settings: Settings): number };

/**
 * `PUT /api/me/settings` (spec §10 "Personal"): the Settings page saves your Auto defaults and your daily job cap.
 * They live on the server (spec §8 `User`), so every device of yours uses the same ones: each connected CLI gets them
 * at once (`settings`), and one that's offline gets them in its next `welcome`; your open tabs get a `me.update`. Only the web app's session cookie
 * may change them: a CLI's token is answered as if no one were signed in, since the CLI only follows them.
 */
export function settingsRoutes(deps: { clis: SettingsSender; meUpdates?: MeUpdates }): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();

  app.put('/api/me/settings', requireUser, requireSameOrigin, async (c) => {
    if (c.get('via') !== 'session') throw new HttpError('unauthorized', 'Sign in with GitHub first.');
    // A cap outside 5 to 200 (the Settings stepper's range) is a 400, like any body that doesn't fit.
    const settings = Settings.parse(await c.req.json());
    const userId = c.get('user').id;
    const saved = settingsOf(await prisma.user.update({ where: { id: userId }, data: settings, select: SETTINGS_COLUMNS }));
    deps.clis.sendSettings(userId, saved);
    // And each of your open tabs, so a second Settings page (or your phone) shows them too.
    await deps.meUpdates?.sendMeUpdate(userId);
    const body: Settings = saved;
    return c.json(body);
  });

  return app;
}
