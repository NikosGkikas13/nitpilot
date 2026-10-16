// Load apps/server/.env if there is one. Variables already set in the environment win.
import 'dotenv/config';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { CLI_WS_PATH, CLOSE_CODES, WEB_WS_PATH } from '@nitpilot/protocol';
import { RepoAccess } from './auth/repo-access';
import { getUserToken } from './auth/user-tokens';
import { Dispatcher } from './chats/dispatch';
import { loadItemsAfter } from './chats/timeline';
import { createApp } from './http/app';
import { createDeliveryHandler } from './ingest/handle';
import { createIngest } from './ingest/process';
import { purgeOldRows } from './ingest/record';
import { recoverOnBoot } from './ingest/recovery';
import { acquireSingletonLock } from './lib/advisory-lock';
import { getEnv } from './lib/env';
import { AppAuth } from './platform/github/app-auth';
import { GithubClient } from './platform/github/client';
import { GithubPlatform } from './platform/github/platform';
import { CliNotifier } from './tasks/cli-notifier';
import { reportFailedWrite } from './tasks/handlers/failed-writes';
import { createTaskHandlers } from './tasks/handlers/index';
import { TaskRunner } from './tasks/runner';
import { CliHub } from './ws/cli-hub';
import { routeUpgrades } from './ws/upgrade-router';
import { WebHub } from './ws/web-hub';
import { wireCliHub } from './ws/wire';

async function main(): Promise<void> {
  const env = getEnv();

  // One server per database (spec §7, docs/why/one-process.md).
  const lock = await acquireSingletonLock(env.DATABASE_URL);
  if (!lock) {
    console.error('Another Nitpilot server is already running against this database. Refusing to start.');
    process.exit(1);
  }

  // The outside world.
  const github = new GithubClient();
  const appAuth = new AppAuth(github, env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const platform = new GithubPlatform(github, appAuth, (userId) => getUserToken(userId, github));
  // CLIs connect over a WebSocket and get their jobs and notifications through it (spec §10, docs/why/websockets.md).
  const hub = new CliHub();
  const notifier = new CliNotifier(hub);
  // Browsers follow chats live over /ws/web: their new items as they're saved (spec §10, docs/why/web-socket-and-origin.md).
  const webHub = new WebHub({ access: new RepoAccess(github), loadItems: loadItemsAfter });

  // The core loop: webhook → ingest → router → dispatcher (engine) → tasks → GitHub, and jobs → CLIs.
  const dispatcher = new Dispatcher();
  const runner = new TaskRunner(createTaskHandlers({ platform, notifier, dispatch: dispatcher.dispatch }), {
    // A review or replies that never reached GitHub shows up in the chat and notifies its owner.
    onGiveUp: reportFailedWrite(dispatcher.dispatch),
  });
  dispatcher.onCommit((_chatId, effects) => {
    if (effects.tasksCreated) runner.wake();
  });
  // Jobs → CLIs: the assigner, leases, and what CLIs report back (ws/wire.ts).
  const cliJobs = wireCliHub({ hub, dispatcher, platform });
  const ingest = createIngest(createDeliveryHandler({ platform, dispatch: dispatcher.dispatch }));

  const app = createApp({ github, appAuth, ingest, dispatch: dispatcher.dispatch, clis: hub, webSockets: webHub });
  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Nitpilot server listening on http://localhost:${info.port}`);
  });
  // serve() makes a plain HTTP/1 server. Each WebSocket upgrade on it goes to the hub for its path.
  routeUpgrades(server as Server, { [CLI_WS_PATH]: hub.handleUpgrade, [WEB_WS_PATH]: webHub.handleUpgrade });

  const recovered = await recoverOnBoot({ ingest, platform });
  console.log(`[boot] re-ran ${recovered.tasks} tasks, replayed ${recovered.replayed} deliveries, asked GitHub to resend ${recovered.redelivered}`);
  runner.start();
  // The server was away, not the CLIs: running jobs get a fresh lease, so CLIs that reconnect keep them.
  await cliJobs.leases.renewAfterRestart();
  cliJobs.start();
  const purge = setInterval(() => void purgeOldRows().catch((err) => console.error('[purge]', err)), 60 * 60_000);
  // Deliveries that failed (a GitHub hiccup, say) get another try once their wait is over.
  const retries = setInterval(() => void ingest.retryDue().catch((err) => console.error('[ingest] retry sweep failed:', err)), 30_000);

  const shutdown = async () => {
    clearInterval(purge);
    clearInterval(retries);
    runner.stop();
    cliJobs.stop();
    // 1012 tells every CLI the server is restarting, so they reconnect.
    hub.closeAll(CLOSE_CODES.serverRestart, 'server restarting');
    webHub.close(CLOSE_CODES.serverRestart, 'server restarting');
    server.close();
    await lock.release();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
