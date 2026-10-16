import type { HealthResponse } from '@nitpilot/protocol';
import { Hono } from 'hono';
import type { RepoAccess } from '../auth/repo-access';
import type { LiveClis } from '../chats/activity';
import type { Dispatch } from '../chats/dispatch';
import type { Ingest } from '../ingest/process';
import { getEnv } from '../lib/env';
import type { AppAuth } from '../platform/github/app-auth';
import type { GithubClient } from '../platform/github/client';
import type { PlatformReads } from '../platform/types';
import { SERVER_VERSION } from '../version';
import { errorBody, onError } from './errors';
import { authRoutes } from './routes/auth';
import { chatRoutes } from './routes/chats';
import { cliRoutes } from './routes/cli';
import { cliApproveRoutes } from './routes/cli-approve';
import { inboxRoutes } from './routes/inbox';
import { meRoutes } from './routes/me';
import { setupRoutes } from './routes/setup';
import { transcriptRoutes } from './routes/transcript';
import { webhookRoutes } from './routes/webhooks';
import { DEFAULT_WEB_DIST, spaRoutes } from './spa';

/** What the HTTP layer needs from outside. Tests pass fakes. Later tasks add fields. */
export type AppDeps = {
  github: GithubClient;
  appAuth: AppAuth;
  ingest: Ingest;
  dispatch: Dispatch;
  clis: LiveClis;
  /** Who can read which repo on GitHub: one 5-minute answer per person and repo, shared by every chat read and the browser's socket. */
  access: RepoAccess;
  /** GitHub reads with the app's installation token (the chat screen's file list). */
  platform: PlatformReads;
  /** The browsers' sockets (ws/web-hub.ts): signing out closes the ones on that session. */
  webSockets?: { closeSession(tokenHash: string): void };
  /** The built web app (apps/web/dist). Tests pass a folder of their own. */
  webDistDir?: string;
};

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.onError(onError);
  app.get('/healthz', (c) => {
    const body: HealthResponse = { ok: true, version: SERVER_VERSION };
    return c.json(body);
  });
  app.route('/', authRoutes(deps));
  app.route('/', meRoutes(deps));
  app.route('/', inboxRoutes(deps));
  app.route('/', chatRoutes(deps));
  app.route('/', cliRoutes(deps));
  app.route('/', cliApproveRoutes());
  app.route('/', setupRoutes(deps));
  app.route('/', transcriptRoutes(deps));
  app.route('/', webhookRoutes(deps));
  // Last: everything else is the web app's (spec §7).
  const env = getEnv();
  app.route('/', spaRoutes({ distDir: deps.webDistDir ?? env.WEB_DIST_DIR ?? DEFAULT_WEB_DIST, publicUrl: env.PUBLIC_URL }));
  app.notFound((c) => c.json(errorBody('not_found', 'no such route'), 404));
  return app;
}
