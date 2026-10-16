import { WEB_WS_PATH, type TimelineItem } from '@nitpilot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { makeChat, makeGithubSignIn, makeMessage, makeRepo, makeUser } from '../../test/db';
import { fakeFetch, json } from '../../test/fake-fetch';
import { sessionCookieFor } from '../../test/http';
import { startWebHub, TestTab } from '../../test/web-ws';
import { sleep, upgradeStatus } from '../../test/ws';
import { ACCESS_TTL_MS, RepoAccess } from '../auth/repo-access';
import { loadItemsAfter } from '../chats/timeline';
import { prisma } from '../lib/prisma';
import { GithubClient } from '../platform/github/client';

/** What GitHub answers about each repo, by full name: read access (200), none (404), or a revoked token (401). */
const github: Record<string, 200 | 401 | 404> = {};
const githubRoutes = new Proxy({} as Parameters<typeof fakeFetch>[0], {
  get: (_routes, key: string) => {
    const repo = key.replace('GET /repos/', '');
    const status = github[repo];
    if (!status) return undefined;
    return () => (status === 200 ? { id: 1 } : json({ message: status === 404 ? 'Not Found' : 'Bad credentials' }, status));
  },
});

let clock = Date.now();
const now = () => clock;
let server: Awaited<ReturnType<typeof startWebHub>> | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

async function start(loadItems: (chatId: string, afterSeq: number) => Promise<TimelineItem[]> = loadItemsAfter) {
  server = await startWebHub({ access: new RepoAccess(new GithubClient(fakeFetch(githubRoutes)), now), loadItems, now });
  return server;
}

/** A signed-in person whose GitHub sign-in is `status`, with the cookie their browser sends. */
async function person(status: 'ok' | 'needs_reauth' = 'ok') {
  const user = await makeUser();
  await makeGithubSignIn(user.id, status);
  return { user, cookie: await sessionCookieFor(user.id) };
}

/** A chat in a repo GitHub says `access` about, with `items` system items already in it. */
async function chatWith(items: number, access: 200 | 401 | 404 = 200) {
  const repo = await makeRepo();
  github[repo.fullName] = access;
  const chat = await makeChat(repo.id);
  for (let i = 0; i < items; i++) await makeMessage(chat.id, null, `item ${i + 1}`);
  return { repo, chat };
}

/** Save one more item, as the dispatcher would, and tell the hub. */
async function commitItem(chatId: string): Promise<TimelineItem> {
  const m = await makeMessage(chatId, null, 'live');
  const [item] = await loadItemsAfter(chatId, m.seq - 1);
  server!.hub.publishItems(chatId, [item!]);
  return item!;
}

describe('WebHub: who may open a socket (spec §10)', () => {
  it('refuses an upgrade without a session (401), from another site (403) or with no Origin (403)', async () => {
    const { port, origin } = await start();
    const { cookie } = await person();
    expect(await upgradeStatus(port, WEB_WS_PATH, { origin })).toBe(401);
    expect(await upgradeStatus(port, WEB_WS_PATH, { origin: 'https://evil.example', cookie })).toBe(403);
    expect(await upgradeStatus(port, WEB_WS_PATH, { cookie })).toBe(403);
    expect(await upgradeStatus(port, WEB_WS_PATH, { origin, cookie })).toBe(101);
  });

  it('closes a socket that sends something that is not a message (1008)', async () => {
    const { url, origin } = await start();
    const tab = await TestTab.open(url, { cookie: (await person()).cookie, origin });
    tab.sendRaw('{"t":"chat.items"}');
    expect((await tab.closed).code).toBe(1008);
  });

  it('closes the socket with 4401 when its session has ended', async () => {
    const { url, origin } = await start();
    const { user, cookie } = await person();
    const { chat } = await chatWith(0);
    const tab = await TestTab.open(url, { cookie, origin });
    await prisma.webSession.deleteMany({ where: { userId: user.id } });
    tab.subscribe(chat.id);
    expect((await tab.closed).code).toBe(4401);
  });
});

describe('WebHub: resuming without gaps (spec §10, Review Focus 1)', () => {
  it('sends what came after afterSeq, then each new item as it is saved', async () => {
    const { url, origin } = await start();
    const { chat } = await chatWith(3);
    const tab = await TestTab.open(url, { cookie: (await person()).cookie, origin });
    tab.subscribe(chat.id, 1);
    expect((await tab.next('chat.items')).d).toMatchObject({ chatId: chat.id, lastSeq: 3, items: [{ seq: 2, body: 'item 2' }, { seq: 3 }] });
    await commitItem(chat.id);
    expect((await tab.next('chat.items')).d).toMatchObject({ lastSeq: 4, items: [{ seq: 4, body: 'live' }] });
  });

  it('says "caught up" with no items when afterSeq is the newest, then sends live items', async () => {
    const { url, origin } = await start();
    const { chat } = await chatWith(2);
    const tab = await TestTab.open(url, { cookie: (await person()).cookie, origin });
    tab.subscribe(chat.id, 2);
    expect((await tab.next('chat.items')).d).toEqual({ chatId: chat.id, items: [], lastSeq: 2 });
    await commitItem(chat.id);
    expect((await tab.next('chat.items')).d.items.map((i) => i.seq)).toEqual([3]);
  });

  it('sends an item saved while the catch-up is being read exactly once', async () => {
    const { chat } = await chatWith(2);
    const { url, origin } = await start(async (chatId, afterSeq) => {
      // The dispatcher saves item 3 and publishes it in the middle of the hub's read…
      await commitItem(chatId);
      // …so the read sees it too.
      return loadItemsAfter(chatId, afterSeq);
    });
    const tab = await TestTab.open(url, { cookie: (await person()).cookie, origin });
    tab.subscribe(chat.id, 0);
    await expect.poll(() => tab.seqs(chat.id)).toEqual([1, 2, 3]);
    await server!.hub.idle();
    await sleep(100);
    expect(tab.seqs(chat.id)).toEqual([1, 2, 3]);
  });

  it('sends a long catch-up in pages of 200, in order', async () => {
    const { url, origin } = await start();
    const { chat } = await chatWith(0);
    const many = Array.from({ length: 450 }, (_, i) => ({ chatId: chat.id, seq: i + 1, kind: 'system', body: `item ${i + 1}` }));
    await prisma.message.createMany({ data: many });
    await prisma.prChat.update({ where: { id: chat.id }, data: { lastSeq: 450 } });
    const tab = await TestTab.open(url, { cookie: (await person()).cookie, origin });
    tab.subscribe(chat.id, 0);
    const pages = [await tab.next('chat.items'), await tab.next('chat.items'), await tab.next('chat.items')];
    expect(pages.map((p) => p.d.items.length)).toEqual([200, 200, 50]);
    expect(pages.map((p) => p.d.lastSeq)).toEqual([200, 400, 450]);
  });
});

describe('WebHub: reading needs access (spec §16, Review Focus 2)', () => {
  it("answers not_found for a chat you can't see or that doesn't exist, and never sends its items", async () => {
    const { url, origin } = await start();
    const { chat } = await chatWith(1, 404);
    const tab = await TestTab.open(url, { cookie: (await person()).cookie, origin });
    tab.subscribe(chat.id);
    expect((await tab.next('chat.error')).d).toEqual({ chatId: chat.id, code: 'not_found' });
    tab.subscribe('no-such-chat');
    expect((await tab.next('chat.error')).d).toEqual({ chatId: 'no-such-chat', code: 'not_found' });
    await commitItem(chat.id);
    await tab.nothing('chat.items');
  });

  it('answers reauth when your GitHub sign-in expired', async () => {
    const { url, origin } = await start();
    const { chat } = await chatWith(1);
    const tab = await TestTab.open(url, { cookie: (await person('needs_reauth')).cookie, origin });
    tab.subscribe(chat.id);
    expect((await tab.next('chat.error')).d.code).toBe('reauth');
  });

  it('asks GitHub again once the answer is 5 minutes old, and stops sending to someone who lost access', async () => {
    const { url, origin } = await start();
    const { repo, chat } = await chatWith(1);
    const tab = await TestTab.open(url, { cookie: (await person()).cookie, origin });
    tab.subscribe(chat.id, 1);
    await tab.next('chat.items');
    // Removed from the repo on GitHub. Within the 5 minutes, items still arrive…
    github[repo.fullName] = 404;
    await commitItem(chat.id);
    expect((await tab.next('chat.items')).d.items.map((i) => i.seq)).toEqual([2]);
    // …after them, the next item asks GitHub, which now says no.
    clock += ACCESS_TTL_MS;
    await commitItem(chat.id);
    expect((await tab.next('chat.error')).d).toEqual({ chatId: chat.id, code: 'not_found' });
    await tab.nothing('chat.items');
    expect(server!.hub.subscribers(chat.id)).toEqual([]);
  });
});

describe('WebHub: subscriptions', () => {
  it('stops sending after an unsubscribe, and forgets a closed socket', async () => {
    const { url, origin } = await start();
    const { chat } = await chatWith(0);
    const { user, cookie } = await person();
    const tab = await TestTab.open(url, { cookie, origin });
    tab.subscribe(chat.id);
    await tab.next('chat.items');
    expect(server!.hub.subscribers(chat.id).map((u) => u.id)).toEqual([user.id]);
    tab.send({ v: 1, t: 'chat.unsubscribe', d: { chatId: chat.id } });
    await server!.hub.idle();
    await commitItem(chat.id);
    await tab.nothing('chat.items');

    const other = await TestTab.open(url, { cookie, origin });
    other.subscribe(chat.id);
    await other.next('chat.items');
    other.close();
    await other.closed;
    await expect.poll(() => server!.hub.subscribers(chat.id)).toEqual([]);
  });

  it('follows several chats on one socket, and sends to a person every socket of theirs', async () => {
    const { url, origin } = await start();
    const [a, b] = [await chatWith(0), await chatWith(0)];
    const { user, cookie } = await person();
    const tab = await TestTab.open(url, { cookie, origin });
    const second = await TestTab.open(url, { cookie, origin });
    tab.subscribe(a.chat.id);
    tab.subscribe(b.chat.id);
    await tab.next('chat.items');
    await tab.next('chat.items');
    await commitItem(b.chat.id);
    expect((await tab.next('chat.items')).d.chatId).toBe(b.chat.id);
    server!.hub.sendToUser(user.id, { v: 1, t: 'inbox.upsert', d: { chatId: a.chat.id, rows: [] } });
    expect((await tab.next('inbox.upsert')).d.chatId).toBe(a.chat.id);
    expect((await second.next('inbox.upsert')).d.chatId).toBe(a.chat.id);
  });
});
