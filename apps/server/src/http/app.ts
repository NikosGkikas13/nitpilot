import type { HealthResponse } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { currentUser } from '../auth/session';
import type { LiveClis } from '../chats/activity';
import type { Dispatch } from '../chats/dispatch';
import type { Ingest } from '../ingest/process';
import { getEnv } from '../lib/env';
import type { AppAuth } from '../platform/github/app-auth';
import type { GithubClient } from '../platform/github/client';
import { SERVER_VERSION } from '../version';
import { onError } from './errors';
import { HomePage } from './pages/home';
import { renderPage } from './pages/layout';
import { authRoutes } from './routes/auth';
import { cliRoutes } from './routes/cli';
import { cliApproveRoutes } from './routes/cli-approve';
import { setupRoutes } from './routes/setup';
import { transcriptRoutes } from './routes/transcript';
import { webhookRoutes } from './routes/webhooks';

/** What the HTTP layer needs from outside. Tests pass fakes. Later tasks add fields. */
export type AppDeps = { github: GithubClient; appAuth: AppAuth; ingest: Ingest; dispatch: Dispatch; clis: LiveClis };

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.onError(onError);
  app.get('/healthz', (c) => {
    const body: HealthResponse = { ok: true, version: SERVER_VERSION };
    return c.json(body);
  });
  app.get('/', async (c) => renderPage(c, HomePage({ user: await currentUser(c), appSlug: getEnv().GITHUB_APP_SLUG })));
  app.route('/', authRoutes(deps));
  app.route('/', cliRoutes(deps));
  app.route('/', cliApproveRoutes());
  app.route('/', setupRoutes(deps));
  app.route('/', transcriptRoutes(deps));
  app.route('/', webhookRoutes(deps));
  return app;
}
