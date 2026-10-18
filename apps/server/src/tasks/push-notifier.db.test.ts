import type { ServerToCli } from '@nitpilot/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeUser, uid } from '../../test/db';
import { prisma } from '../lib/prisma';
import type { CliConnection } from '../ws/cli-hub';
import { CliNotifier } from './cli-notifier';
import { FallbackNotifier, type Notification } from './notifier';
import { MAX_PUSH_FAILURES, PushNotifier } from './push-notifier';
import type { PushResult, PushSend } from './web-push-send';

// A failed send writes a line to the server log; these tests fail sends on purpose.
beforeEach(() => void vi.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

const OK: PushResult = { ok: true };
const GONE: PushResult = { ok: false, gone: true, answered: true, error: 'the push service answered 410' };
const DOWN: PushResult = { ok: false, gone: false, answered: true, error: 'the push service answered 503' };
/** No reply at all (our network is down, a key is bad): not the subscription's fault. */
const NO_ANSWER: PushResult = { ok: false, gone: false, answered: false, error: 'getaddrinfo ENOTFOUND push.example.com' };

/** A pretend push service: each endpoint answers what the test says (OK if it says nothing). It records every send. */
function fakePush(answers: Record<string, PushResult> = {}) {
  const sent: { endpoint: string; payload: unknown; ok: boolean }[] = [];
  const send: PushSend = async (sub, payload) => {
    const answer = answers[sub.endpoint] ?? OK;
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), ok: answer.ok });
    return answer;
  };
  return { send, sent };
}

/** A subscription of `userId`'s, as the browser hands it out: a push service URL and the keys to encrypt for it. */
async function subscribe(userId: string, over: { failCount?: number } = {}) {
  return prisma.pushSubscription.create({
    data: { userId, endpoint: `https://push.example.com/send/${uid('sub')}`, p256dh: 'BKey', auth: 'authKey', label: 'Chrome on macOS', failCount: over.failCount ?? 0 },
  });
}

const stillThere = async (id: string) => (await prisma.pushSubscription.findUnique({ where: { id } })) !== null;
const failCountOf = async (id: string) => (await prisma.pushSubscription.findUniqueOrThrow({ where: { id } })).failCount;

const ready = (userIds: string[]): Notification => ({
  userIds,
  kind: 'ready',
  chatId: 'chat_1',
  title: 'Ready for your approval',
  body: 'acme/shop-api#142',
  url: 'http://localhost:8787/c/acme/shop-api/142',
});

describe('PushNotifier', () => {
  it("sends the notification to each of a person's subscriptions, and one that arrives reaches them", async () => {
    const maya = await makeUser();
    const [laptop, phone] = [await subscribe(maya.id), await subscribe(maya.id)];
    const push = fakePush({ [phone.endpoint]: DOWN });
    expect(await new PushNotifier(push.send).notify(ready([maya.id]))).toEqual({ reached: [maya.id] });
    // What the service worker shows: the heading, the detail, where a click goes, and the chat as the tag, so a newer
    // notification about the same chat replaces the older one.
    const payload = { title: 'Ready for your approval', body: 'acme/shop-api#142', url: 'http://localhost:8787/c/acme/shop-api/142', tag: 'chat_1' };
    expect(push.sent).toEqual([{ endpoint: laptop.endpoint, payload, ok: true }, { endpoint: phone.endpoint, payload, ok: false }]);
  });

  it("doesn't reach someone whose subscriptions all failed, or who has none", async () => {
    const [maya, leo] = [await makeUser(), await makeUser()];
    const sub = await subscribe(maya.id);
    const push = fakePush({ [sub.endpoint]: DOWN });
    expect(await new PushNotifier(push.send).notify(ready([maya.id, leo.id]))).toEqual({ reached: [] });
  });

  it('deletes a subscription the push service calls gone (404 or 410)', async () => {
    const maya = await makeUser();
    const sub = await subscribe(maya.id);
    await new PushNotifier(fakePush({ [sub.endpoint]: GONE }).send).notify(ready([maya.id]));
    expect(await stillThere(sub.id)).toBe(false);
  });

  it(`counts failures in a row, starts again after a success, and deletes a subscription at the ${MAX_PUSH_FAILURES}th`, async () => {
    const maya = await makeUser();
    const sub = await subscribe(maya.id);
    const down = new PushNotifier(fakePush({ [sub.endpoint]: DOWN }).send);
    const up = new PushNotifier(fakePush().send);

    await down.notify(ready([maya.id]));
    await down.notify(ready([maya.id]));
    expect(await failCountOf(sub.id)).toBe(2);
    await up.notify(ready([maya.id]));
    expect(await failCountOf(sub.id)).toBe(0);

    for (let i = 1; i < MAX_PUSH_FAILURES; i++) await down.notify(ready([maya.id]));
    expect(await failCountOf(sub.id)).toBe(MAX_PUSH_FAILURES - 1);
    await down.notify(ready([maya.id]));
    expect(await stillThere(sub.id)).toBe(false);
  });

  it("keeps going for everyone else when one send throws, and doesn't hold it against the subscription", async () => {
    const [maya, leo] = [await makeUser(), await makeUser()];
    const [broken, fine] = [await subscribe(maya.id), await subscribe(leo.id)];
    const send: PushSend = async (sub) => {
      if (sub.endpoint === broken.endpoint) throw new Error('boom');
      return OK;
    };
    expect(await new PushNotifier(send).notify(ready([maya.id, leo.id]))).toEqual({ reached: [leo.id] });
    expect(await failCountOf(broken.id)).toBe(0);
    expect(await stillThere(fine.id)).toBe(true);
  });

  it('never counts a send that got no answer against a subscription: it stays, and the person is not reached', async () => {
    const maya = await makeUser();
    const sub = await subscribe(maya.id);
    const notifier = new PushNotifier(fakePush({ [sub.endpoint]: NO_ANSWER }).send);
    for (let i = 0; i < MAX_PUSH_FAILURES + 1; i++) expect(await notifier.notify(ready([maya.id]))).toEqual({ reached: [] });
    expect(await stillThere(sub.id)).toBe(true);
    expect(await failCountOf(sub.id)).toBe(0);
  });

  it('reaches nobody and leaves the subscriptions alone when push is off (no VAPID keys)', async () => {
    const maya = await makeUser();
    const sub = await subscribe(maya.id);
    expect(await new PushNotifier(null).notify(ready([maya.id]))).toEqual({ reached: [] });
    expect(await failCountOf(sub.id)).toBe(0);
  });
});

/**
 * A pretend CLI hub: each person has one CLI that takes every message. Real sockets would work too
 * (cli-notifier.db.test.ts); these let the test read what each person's CLI got, synchronously.
 */
function fakeHub(userIds: string[]) {
  const got = new Map<string, Extract<ServerToCli, { t: 'notify' }>['d'][]>(userIds.map((id) => [id, []]));
  const connectionFor = (userId: string) =>
    ({ send: (msg: ServerToCli) => (msg.t === 'notify' && got.get(userId)!.push(msg.d), true) }) as unknown as CliConnection;
  return { hub: { connectionsFor: (userId: string) => (got.has(userId) ? [connectionFor(userId)] : []) }, got };
}

// Review Focus 5: a subscription goes stale, and the same notification still reaches the person, through the CLI.
// Never zero pings for someone with a CLI online, never two. "A ping" is anything that alerts: a Web Push that
// arrived, or the CLI's OS notification (`alert: true`). The CLI's terminal line is always printed.
describe('Web Push first, the CLI as fallback', () => {
  it('gives each person exactly one alerting ping, deleting the subscriptions that are gone', async () => {
    const [ana, ben, cy] = [await makeUser({ login: 'ana' }), await makeUser({ login: 'ben' }), await makeUser({ login: 'cy' })];
    const anasOnly = await subscribe(ana.id); // site data cleared: the push service answers 410
    const [bensWorking, bensGone] = [await subscribe(ben.id), await subscribe(ben.id)];
    // cy never turned push on.
    const push = fakePush({ [anasOnly.endpoint]: GONE, [bensGone.endpoint]: GONE });
    const { hub, got } = fakeHub([ana.id, ben.id, cy.id]);
    const offline = { notify: vi.fn(async () => ({ reached: [] })) };
    const notifier = new FallbackNotifier(new PushNotifier(push.send), new CliNotifier(hub, offline));

    const { reached } = await notifier.notify(ready([ana.id, ben.id, cy.id]));

    expect(await stillThere(anasOnly.id)).toBe(false);
    expect(await stillThere(bensGone.id)).toBe(false);
    expect(await stillThere(bensWorking.id)).toBe(true);
    const line = { kind: 'ready', chatId: 'chat_1', title: 'Ready for your approval: acme/shop-api#142', url: 'http://localhost:8787/c/acme/shop-api/142' };
    expect(got.get(ana.id)).toEqual([{ ...line, alert: true }]);
    expect(got.get(ben.id)).toEqual([{ ...line, alert: false }]);
    expect(got.get(cy.id)).toEqual([{ ...line, alert: true }]);
    const owner = new Map([anasOnly, bensWorking, bensGone].map((sub) => [sub.endpoint, sub.userId]));
    for (const user of [ana, ben, cy]) {
      const pushArrived = push.sent.some((s) => s.ok && owner.get(s.endpoint) === user.id) ? 1 : 0;
      const osAlerts = got.get(user.id)!.filter((d) => d.alert).length;
      expect(pushArrived + osAlerts, user.login).toBe(1);
    }
    expect(reached.sort()).toEqual([ana.id, ben.id, cy.id].sort());
    expect(offline.notify).not.toHaveBeenCalled();
  });

  it("logs only those nothing reached: push did, so a person with no CLI online isn't logged", async () => {
    const [maya, leo] = [await makeUser(), await makeUser()];
    await subscribe(maya.id);
    const offline = { notify: vi.fn(async () => ({ reached: [] })) };
    const notifier = new FallbackNotifier(new PushNotifier(fakePush().send), new CliNotifier(fakeHub([]).hub, offline));
    expect(await notifier.notify(ready([maya.id, leo.id]))).toEqual({ reached: [maya.id] });
    expect(offline.notify).toHaveBeenCalledExactlyOnceWith({ ...ready([leo.id]), alert: true });
  });

  it('with push off, is Plan 1: every CLI alerts', async () => {
    const maya = await makeUser();
    await subscribe(maya.id);
    const { hub, got } = fakeHub([maya.id]);
    await new FallbackNotifier(new PushNotifier(null), new CliNotifier(hub)).notify(ready([maya.id]));
    expect(got.get(maya.id)!.map((d) => d.alert)).toEqual([true]);
  });
});
