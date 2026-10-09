import { describe, expect, it } from 'vitest';
import { KeyedLock } from './key-lock';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('KeyedLock', () => {
  it('runs work for the same key one at a time, and different keys in parallel', async () => {
    const lock = new KeyedLock();
    const log: string[] = [];
    const job = (key: string, name: string) => lock.run(key, async () => { log.push(`start ${name}`); await tick(); log.push(`end ${name}`); });
    await Promise.all([job('chat-1', 'a'), job('chat-1', 'b'), job('chat-2', 'c')]);
    expect(log.indexOf('end a')).toBeLessThan(log.indexOf('start b'));
    expect(log.indexOf('start c')).toBeLessThan(log.indexOf('end a'));
  });

  it('keeps going after a failure', async () => {
    const lock = new KeyedLock();
    await expect(lock.run('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(lock.run('k', async () => 'ok')).resolves.toBe('ok');
  });
});
