// Load apps/server/.env if there is one. Variables already set in the environment win.
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './http/app';
import { acquireSingletonLock } from './lib/advisory-lock';
import { getEnv } from './lib/env';
import { GithubClient } from './platform/github/client';

async function main(): Promise<void> {
  const env = getEnv();

  const lock = await acquireSingletonLock(env.DATABASE_URL);
  if (!lock) {
    console.error('Another Nitpilot server is already running against this database. Refusing to start.');
    process.exit(1);
  }

  const github = new GithubClient();
  const app = createApp({ github });
  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Nitpilot server listening on http://localhost:${info.port}`);
  });

  const shutdown = async () => {
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
