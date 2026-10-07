// Load apps/server/.env if there is one. Variables already set in the environment win.
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './http/app';
import { createIngest } from './ingest/process';
import { purgeOldRows } from './ingest/record';
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
  // Until Task 23 the server stores deliveries but has nothing to do with them yet.
  const ingest = createIngest(async (d) => ({ status: 'ignored', note: `no handler for ${d.event} yet` }));
  const app = createApp({ github, ingest });
  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Nitpilot server listening on http://localhost:${info.port}`);
  });

  await ingest.replayReceived();
  const purge = setInterval(() => void purgeOldRows().catch((err) => console.error('[purge]', err)), 60 * 60_000);

  const shutdown = async () => {
    clearInterval(purge);
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
