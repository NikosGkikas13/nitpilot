import { Hono } from 'hono';
import { currentUser } from '../../auth/session';
import { syncInstallationFromApi } from '../../ingest/installations';
import type { AppAuth } from '../../platform/github/app-auth';
import type { GithubClient } from '../../platform/github/client';
import { HttpError } from '../errors';

/** GitHub sends people here after they install or reconfigure the app (spec §10). */
export function setupRoutes(deps: { github: GithubClient; appAuth: AppAuth }): Hono {
  const app = new Hono();
  app.get('/github/setup', async (c) => {
    if (!(await currentUser(c))) {
      const here = new URL(c.req.url);
      return c.redirect(`/auth/github/login?next=${encodeURIComponent(here.pathname + here.search)}`);
    }
    const installationId = c.req.query('installation_id');
    if (!installationId || !/^\d+$/.test(installationId)) throw new HttpError('validation_error', 'missing installation_id');
    await syncInstallationFromApi(installationId, deps.github, deps.appAuth);
    return c.redirect('/');
  });
  return app;
}
