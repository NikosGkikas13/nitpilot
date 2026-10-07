import { describe, expect, it } from 'vitest';
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
});
