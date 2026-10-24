import pg from 'pg';

/** "nitpilot" typed on a phone keypad. Any fixed number works; it just has to be the same everywhere. */
export const SINGLETON_LOCK_KEY = 64874568;

export type SingletonLock = { release(): Promise<void> };

/**
 * Take a Postgres advisory lock, so only one Nitpilot server runs against a database.
 * The per-chat locks and WebSocket hubs live in memory, so a second process would break
 * them (spec §7). The lock lives as long as this dedicated connection stays open.
 * Returns null when another process already holds it.
 *
 * If the connection later dies on its own (the database restarted, the network dropped), Postgres frees the lock and
 * another server could take it, so `onLost` is called, once, and the caller should exit. Closing it ourselves in
 * `release()` is not a loss.
 */
export async function acquireSingletonLock(
  databaseUrl: string,
  key = SINGLETON_LOCK_KEY,
  onLost?: (err: Error) => void,
): Promise<SingletonLock | null> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let releasing = false;
  let reported = false;
  const lost = (err: Error) => {
    if (releasing || reported) return;
    reported = true;
    onLost?.(err);
  };
  // 'error' is usually followed by 'end'; without a listener, an 'error' would crash the process by itself.
  client.on('error', lost);
  client.on('end', () => lost(new Error('the lock connection ended')));
  const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [key]);
  if (!rows[0]?.locked) {
    await client.end();
    return null;
  }
  return {
    async release() {
      releasing = true;
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
      await client.end();
    },
  };
}
