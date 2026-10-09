import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { testDatabaseUrl } from './test-database';

const serverDir = fileURLToPath(new URL('..', import.meta.url));

/**
 * Runs once, before the first database test file: creates the test database if it's missing and
 * applies every migration to it, so it always has the same tables as the dev one.
 */
export default async function setup(): Promise<void> {
  const devUrl = process.env.DATABASE_URL;
  if (!devUrl) throw new Error('DATABASE_URL is not set. Copy apps/server/.env.example to apps/server/.env.');
  const testUrl = testDatabaseUrl(devUrl);

  await createDatabaseIfMissing(testUrl);
  // Same command as `npm run db:deploy`, aimed at the test database. Its output is kept quiet;
  // when it fails, the thrown error carries what Prisma printed.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: serverDir, env: { ...process.env, DATABASE_URL: testUrl }, stdio: 'pipe' });
}

async function createDatabaseIfMissing(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const name = url.pathname.slice(1);
  // A database can't be created from inside itself, so connect to "postgres",
  // the database every Postgres server has.
  url.pathname = '/postgres';
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (found.rowCount === 0) await client.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
  } finally {
    await client.end();
  }
}
