import type { HealthResponse } from '@nitpilot/protocol';
import { Hono, type Context } from 'hono';
import type { RepoAccess } from '../auth/repo-access';
import type { LiveClis } from '../chats/activity';
import type { Dispatch } from '../chats/dispatch';
import type { Ingest } from '../ingest/process';
import { getEnv } from '../lib/env';
import type { AppAuth } from '../platform/github/app-auth';
import type { GithubClient } from '../platform/github/client';
import type { PlatformReads } from '../platform/types';
import { firstRunRoutes, readyRoutes, type FirstRunDeps } from '../setup/first-run';
import type { MeUpdates } from '../ws/web-wire';
import { SERVER_VERSION } from '../version';
import { errorBody, onError } from './errors';
import { authRoutes } from './routes/auth';
import { chatActionRoutes } from './routes/chat-actions';
import { chatDraftRoutes } from './routes/chat-drafts';
import { chatRoutes } from './routes/chats';
import { cliRoutes } from './routes/cli';
import { cliRequestRoutes } from './routes/cli-requests';
import { deviceRoutes, type DeviceClis } from './routes/devices';
import { inboxRoutes } from './routes/inbox';
import { meRoutes } from './routes/me';
import { onboardingRoutes } from './routes/onboarding';
import { pushRoutes } from './routes/push';
import { settingsRoutes, type SettingsSender } from './routes/settings';
import { setupRoutes } from './routes/setup';
import { webhookRoutes } from './routes/webhooks';
import { DEFAULT_WEB_DIST, isServerPath, spaRoutes } from './spa';

/** What the HTTP layer needs from outside. Tests pass fakes. Later tasks add fields. */
export type AppDeps = {
  github: GithubClient;
  appAuth: AppAuth;
  ingest: Ingest;
  dispatch: Dispatch;
  /** The connected CLIs (the CLI hub): who is online, where new settings go, and hanging up on a revoked device. */
  clis: LiveClis & SettingsSender & DeviceClis;
  /** Who can read which repo on GitHub: one 5-minute answer per person and repo, shared by every chat read and the browser's socket. */
  access: RepoAccess;
  /** GitHub reads: with the app's installation token (the chat screen's file list), and with a person's own (the setup checklist). */
  platform: PlatformReads;
  /** The server's public Web Push key (VAPID), which browsers subscribe with; null when push is off (lib/env.ts). */
  vapidPublicKey: string | null;
  /** The browsers' sockets (ws/web-hub.ts): signing out closes the ones on that session. */
  webSockets?: { closeSession(tokenHash: string): void };
  /** Tells a person's open tabs that something about them changed (ws/web-wire.ts): after settings, device and push writes, and a CLI login. */
  meUpdates?: MeUpdates;
  /** Read the client's address from X-Forwarded-For (we're behind our own proxy). Defaults to env TRUST_PROXY. */
  trustProxy?: boolean;
  /** The built web app (apps/web/dist). Tests pass a folder of their own. */
  webDistDir?: string;
};

/** `GET /healthz`: Docker's HEALTHCHECK and uptime checks ask it, in both modes. */
function health(c: Context): Response {
  const body: HealthResponse = { ok: true, version: SERVER_VERSION };
  return c.json(body);
}

export function createApp(deps: AppDeps): Hono {
  const env = getEnv();
  const app = new Hono();
  app.onError(onError);
  app.get('/healthz', health);
  app.route('/', readyRoutes(deps));
  app.route('/', authRoutes(deps));
  app.route('/', meRoutes(deps));
  app.route('/', settingsRoutes(deps));
  app.route('/', pushRoutes(deps));
  app.route('/', deviceRoutes(deps));
  app.route('/', onboardingRoutes(deps));
  app.route('/', inboxRoutes(deps));
  app.route('/', chatRoutes(deps));
  app.route('/', chatActionRoutes(deps));
  app.route('/', chatDraftRoutes(deps));
  app.route('/', cliRoutes({ ...deps, trustProxy: deps.trustProxy ?? env.TRUST_PROXY }));
  app.route('/', cliRequestRoutes());
  app.route('/', setupRoutes(deps));
  app.route('/', webhookRoutes(deps));
  // Last: everything else is the web app's (spec §7).
  app.route('/', spaRoutes({ distDir: deps.webDistDir ?? env.WEB_DIST_DIR ?? DEFAULT_WEB_DIST, publicUrl: env.PUBLIC_URL }));
  app.notFound((c) => c.json(errorBody('not_found', 'no such route'), 404));
  return app;
}

/**
 * The server in first-run mode (setup/boot.ts): it has no GitHub App yet, so it serves only what creating one needs,
 * the health check, the first-run routes and the web app (whose /first-run page does the asking). Every other server
 * path, whatever the method, is a 503 that says where to go: no sign-in, webhook or API call can work without an app.
 * Forms on the page may post to GitHub: the manifest goes there as a form (http/spa.ts contentSecurityPolicy).
 */
export function createFirstRunApp(deps: FirstRunDeps & { webDistDir?: string }): Hono {
  const env = getEnv();
  const app = new Hono();
  app.onError(onError);
  app.get('/healthz', health);
  app.route('/', firstRunRoutes(deps));
  app.all('*', async (c, next) => {
    if (!isServerPath(c.req.path)) return next();
    return c.json(errorBody('first_run', 'Finish setup at /first-run.'), 503);
  });
  app.route('/', spaRoutes({ distDir: deps.webDistDir ?? env.WEB_DIST_DIR ?? DEFAULT_WEB_DIST, publicUrl: deps.publicUrl, formActions: [deps.github.webBase] }));
  app.notFound((c) => c.json(errorBody('not_found', 'no such route'), 404));
  return app;
}
