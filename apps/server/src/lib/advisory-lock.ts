import pg from 'pg';

/** "nitpilot" typed on a phone keypad. Any fixed number works; it just has to be the same everywhere. */
export const SINGLETON_LOCK_KEY = 64874568;

export type SingletonLock = { release(): Promise<void> };

/**
 * Take a Postgres advisory lock, so only one Nitpilot server runs against a database.
 * The per-chat locks and WebSocket hubs live in memory, so a second process would break
 * them (spec §7). The lock lives as long as this dedicated connection stays open.
 * Returns null when another process already holds it.
 */
export async function acquireSingletonLock(databaseUrl: string, key = SINGLETON_LOCK_KEY): Promise<SingletonLock | null> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [key]);
  if (!rows[0]?.locked) {
    await client.end();
    return null;
  }
  return {
    async release() {
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
      await client.end();
    },
  };
}
