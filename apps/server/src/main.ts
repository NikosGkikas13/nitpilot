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
import { purgeClosedChats, purgeOldRows } from './ingest/record';
import { recoverOnBoot } from './ingest/recovery';
import { acquireSingletonLock, type SingletonLock } from './lib/advisory-lock';
import { getEnv, vapidDetails, type Env } from './lib/env';
import { AppAuth } from './platform/github/app-auth';
import { GithubClient } from './platform/github/client';
import { GithubPlatform } from './platform/github/platform';
import { startFirstRun } from './setup/boot';
import { loadGithubApp, setGithubApp, type GithubAppCredentials } from './setup/credentials';
import { CliNotifier } from './tasks/cli-notifier';
import { reportFailedWrite } from './tasks/handlers/failed-writes';
import { createTaskHandlers } from './tasks/handlers/index';
import { FallbackNotifier } from './tasks/notifier';
import { PushNotifier } from './tasks/push-notifier';
import { TaskRunner } from './tasks/runner';
import { webPushSend } from './tasks/web-push-send';
import { CliHub } from './ws/cli-hub';
import { routeUpgrades } from './ws/upgrade-router';
import { WebHub } from './ws/web-hub';
import { wireWebHub } from './ws/web-wire';
import { wireCliHub } from './ws/wire';

async function main(): Promise<void> {
  const env = getEnv();

  // One server per database (spec §7, docs/why/one-process.md).
  const lock = await acquireSingletonLock(env.DATABASE_URL, undefined, (err) => {
    // The lock is gone, so another server could start against this database. Stop, and let Docker restart us.
    console.error('[lock] lost the database connection; exiting so Docker restarts the server', err);
    process.exit(1);
  });
  if (!lock) {
    console.error('Another Nitpilot server is already running against this database. Refusing to start.');
    process.exit(1);
  }

  // Which GitHub App this server is: the GITHUB_* variables, else the one first-run mode stored, else none yet.
  // A stored app this ENCRYPTION_KEY can't read throws here, and the server refuses to start (setup/credentials.ts).
  const loaded = await loadGithubApp(env);
  if (!loaded) return runFirstRun(env, lock);
  setGithubApp(loaded.creds);
  console.log(`[boot] GitHub App ${loaded.creds.slug}, from the ${loaded.source === 'env' ? 'GITHUB_* variables' : 'database'}`);
  await runNormally(env, lock, loaded.creds);
}

/**
 * First-run mode (spec §17 "Self-hosting", docs/why/first-run-and-app-manifests.md): no GitHub App yet, so serve only
 * the page that creates one. No task runner, hubs or recovery: none of them can work without an app. Once the app is
 * stored the process exits with 0, and Docker (`restart: unless-stopped`) starts it again, in normal mode this time.
 */
function runFirstRun(env: Env, lock: SingletonLock): void {
  // After the app is stored, and on SIGTERM. Exit code 0 either way: nothing went wrong. (`server` is made just below,
  // long before either can happen.)
  const exit = async () => {
    server.close();
    try {
      await lock.release();
    } finally {
      process.exit(0);
    }
  };
  const { app } = startFirstRun({ env, github: new GithubClient(), exit: () => void exit() });
  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Nitpilot server listening on http://localhost:${info.port}, in first-run mode`);
  }) as Server;
  // No hub yet: every WebSocket upgrade gets a 404.
  routeUpgrades(server, {});
  process.on('SIGINT', exit);
  process.on('SIGTERM', exit);
}

/** The server with its GitHub App: webhooks in, jobs out to the CLIs, the web app. */
async function runNormally(env: Env, lock: SingletonLock, creds: GithubAppCredentials): Promise<void> {
  // The outside world.
  const github = new GithubClient();
  const appAuth = new AppAuth(github, creds.appId, creds.privateKey);
  const platform = new GithubPlatform(github, appAuth, (userId) => getUserToken(userId, github));
  // CLIs connect over a WebSocket and get their jobs and notifications through it (spec §10, docs/why/websockets.md).
  const hub = new CliHub();
  // Notifications: Web Push to every browser and device a person subscribed, then their CLI, which alerts only for
  // people no push reached (spec §16, docs/why/web-push.md). Without VAPID keys push is off: the CLI alerts everyone.
  const vapid = vapidDetails(env);
  const notifier = new FallbackNotifier(new PushNotifier(vapid ? webPushSend(vapid) : null), new CliNotifier(hub));
  // Browsers follow chats live over /ws/web: their new items as they're saved (spec §10, docs/why/web-socket-and-origin.md).
  // One answer per person and repo to "can they read it?", for every chat read and the browser's socket (auth/repo-access.ts).
  const access = new RepoAccess(github);
  const webHub = new WebHub({ access, loadItems: loadItemsAfter });

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
  // Commits, CLI presence and progress → the browsers following along (ws/web-wire.ts).
  const live = wireWebHub({ webHub, dispatcher, cliHub: hub, access, vapidPublicKey: vapid?.publicKey ?? null });
  const ingest = createIngest(createDeliveryHandler({ platform, dispatch: dispatcher.dispatch }));

  const app = createApp({
    github, appAuth, ingest, dispatch: dispatcher.dispatch, clis: hub, access, platform, webSockets: webHub, meUpdates: live, vapidPublicKey: vapid?.publicKey ?? null,
  });
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
  const purge = setInterval(() => {
    void purgeOldRows().catch((err) => console.error('[purge]', err));
    // Hosted instance only: self-hosters keep their closed chats.
    if (env.CLOSED_CHAT_RETENTION_DAYS) void purgeClosedChats(new Date(), env.CLOSED_CHAT_RETENTION_DAYS).catch((err) => console.error('[purge]', err));
  }, 60 * 60_000);
  // Deliveries that failed (a GitHub hiccup, say) get another try once their wait is over.
  const retries = setInterval(() => void ingest.retryDue().catch((err) => console.error('[ingest] retry sweep failed:', err)), 30_000);

  const shutdown = async () => {
    clearInterval(purge);
    clearInterval(retries);
    // Let the task in flight finish and save its outcome, so it isn't cut off mid-write and run again at the next boot.
    await runner.stop();
    cliJobs.stop();
    live.stop();
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
