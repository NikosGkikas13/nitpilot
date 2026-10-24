import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { acquireSingletonLock } from './advisory-lock';

describe('acquireSingletonLock', () => {
  it('lets only one process hold the lock at a time', async () => {
    const url = process.env.DATABASE_URL!;
    const key = 900_000 + Math.floor(Math.random() * 99_999); // a key no dev server uses

    const first = await acquireSingletonLock(url, key);
    expect(first).not.toBeNull();
    expect(await acquireSingletonLock(url, key)).toBeNull();

    await first!.release();
    const again = await acquireSingletonLock(url, key);
    expect(again).not.toBeNull();
    await again!.release();
  });

  it('tells the server when the lock connection dies', async () => {
    const url = process.env.DATABASE_URL!;
    const key = 900_000 + Math.floor(Math.random() * 99_999);
    const lost = vi.fn();
    const lock = await acquireSingletonLock(url, key, lost);
    expect(lock).not.toBeNull();

    // Kill the connection holding the lock from outside, as a database restart or network drop would.
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND objid = $1", [key]);
    await admin.end();

    await vi.waitFor(() => expect(lost).toHaveBeenCalledOnce());
    // The error and the end that follow it are one loss, reported once.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lost).toHaveBeenCalledOnce();
  });

  it('does not call onLost when the lock is released on purpose', async () => {
    const lost = vi.fn();
    const lock = await acquireSingletonLock(process.env.DATABASE_URL!, 900_000 + Math.floor(Math.random() * 99_999), lost);
    await lock!.release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lost).not.toHaveBeenCalled();
  });
});
