// Load apps/server/.env if there is one. Variables already set in the environment win.
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { getUserToken } from './auth/user-tokens';
import { Dispatcher } from './chats/dispatch';
import { createApp } from './http/app';
import { createDeliveryHandler } from './ingest/handle';
import { createIngest } from './ingest/process';
import { purgeOldRows } from './ingest/record';
import { acquireSingletonLock } from './lib/advisory-lock';
import { getEnv } from './lib/env';
import { AppAuth } from './platform/github/app-auth';
import { GithubClient } from './platform/github/client';
import { GithubPlatform } from './platform/github/platform';
import { createTaskHandlers } from './tasks/handlers/index';
import { LogNotifier } from './tasks/notifier';
import { recoverRunningTasks, TaskRunner } from './tasks/runner';

async function main(): Promise<void> {
  const env = getEnv();

  const lock = await acquireSingletonLock(env.DATABASE_URL);
  if (!lock) {
    console.error('Another Nitpilot server is already running against this database. Refusing to start.');
    process.exit(1);
  }

  const github = new GithubClient();
  const appAuth = new AppAuth(github, env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const platform = new GithubPlatform(github, appAuth, (userId) => getUserToken(userId, github));
  const dispatcher = new Dispatcher();
  const notifier = new LogNotifier();
  const runner = new TaskRunner(createTaskHandlers({ platform, notifier, dispatch: dispatcher.dispatch }));
  dispatcher.onCommit((_chatId, effects) => {
    if (effects.tasksCreated) runner.wake();
  });
  const ingest = createIngest(createDeliveryHandler({ platform, dispatch: dispatcher.dispatch }));
  const app = createApp({ github, appAuth, ingest });
  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Nitpilot server listening on http://localhost:${info.port}`);
  });

  await ingest.replayReceived();
  await recoverRunningTasks();
  runner.start();
  const purge = setInterval(() => void purgeOldRows().catch((err) => console.error('[purge]', err)), 60 * 60_000);

  const shutdown = async () => {
    clearInterval(purge);
    runner.stop();
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
