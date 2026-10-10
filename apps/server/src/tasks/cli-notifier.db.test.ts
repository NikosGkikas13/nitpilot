import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCliToken, makeUser } from '../../test/db';
import { startCliServer, TestCli, type CliServer } from '../../test/ws';
import type { CliConnection } from '../ws/cli-hub';
import { CliNotifier } from './cli-notifier';
import type { Notification } from './notifier';

let s: CliServer;
beforeEach(async () => {
  s = await startCliServer();
});
afterEach(() => s.close());

const ready = (userIds: string[]): Notification => ({
  userIds,
  kind: 'ready',
  chatId: 'chat_1',
  title: 'Ready for your approval: acme/shop-api#142',
  url: 'http://localhost:8787/c/acme/shop-api/142',
});

describe('CliNotifier', () => {
  it("reaches every one of a user's CLIs", async () => {
    const leo = await makeUser({ login: 'leo' });
    const laptop = await TestCli.online(s.url, (await makeCliToken(leo.id)).raw, { device: 'laptop' });
    const desktop = await TestCli.online(s.url, (await makeCliToken(leo.id)).raw, { device: 'desktop' });
    const offline = { notify: vi.fn(async () => {}) };
    await new CliNotifier(s.hub, offline).notify(ready([leo.id]));
    const expected = { kind: 'ready', chatId: 'chat_1', title: 'Ready for your approval: acme/shop-api#142', url: 'http://localhost:8787/c/acme/shop-api/142' };
    expect((await laptop.next('notify')).d).toEqual(expected);
    expect((await desktop.next('notify')).d).toEqual(expected);
    expect(offline.notify).not.toHaveBeenCalled();
  });

  it('falls back to the server log for people with no CLI online', async () => {
    const leo = await makeUser({ login: 'leo' });
    const kim = await makeUser({ login: 'kim' });
    const laptop = await TestCli.online(s.url, (await makeCliToken(leo.id)).raw);
    const offline = { notify: vi.fn(async () => {}) };
    await new CliNotifier(s.hub, offline).notify(ready([leo.id, kim.id]));
    await laptop.next('notify');
    expect(offline.notify).toHaveBeenCalledWith(ready([kim.id]));
  });

  it("falls back to the server log for someone whose only CLI can't be reached", async () => {
    // A real socket can't be made to refuse a send on demand, so these connections are stand-ins:
    // send() returns false the way it does for a socket that is closing.
    const closing = { send: vi.fn(() => false) } as unknown as CliConnection;
    const working = { send: vi.fn(() => true) } as unknown as CliConnection;
    const hub = { connectionsFor: (userId: string) => (userId === 'leo' ? [closing] : [closing, working]) };
    const offline = { notify: vi.fn(async () => {}) };
    await new CliNotifier(hub, offline).notify(ready(['leo', 'kim']));
    // leo's only CLI is closing, so he gets the log line. kim has one that took it, so she doesn't.
    expect(offline.notify).toHaveBeenCalledWith(ready(['leo']));
    expect(working.send).toHaveBeenCalledOnce();
  });
});
