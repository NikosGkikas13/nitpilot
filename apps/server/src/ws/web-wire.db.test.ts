import type { TimelineItem } from '@nitpilot/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeChat, makeCliToken, makeGithubSignIn, makeRepo, makeUser, personOf } from '../../test/db';
import { fakeFetch, json } from '../../test/fake-fetch';
import { sessionCookieFor } from '../../test/http';
import { startWebHub, TestTab } from '../../test/web-ws';
import { listen, sleep, TestCli } from '../../test/ws';
import { RepoAccess } from '../auth/repo-access';
import { Dispatcher } from '../chats/dispatch';
import { loadItemsAfter } from '../chats/timeline';
import { prisma } from '../lib/prisma';
import { GithubClient } from '../platform/github/client';
import { CliHub } from './cli-hub';
import { wireWebHub } from './web-wire';

const DEBOUNCE_MS = 30;
const stops: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const stop of stops.splice(0).reverse()) await stop();
});

/** The server's live side, wired as main.ts wires it: a dispatcher, a CLI hub and a web hub. maya's PR, leo asked to review. */
type LoadItems = (chatId: string, afterSeq: number) => Promise<TimelineItem[]>;

/**
 * `loadItems`: how the wiring reads new items. `catchUp`: how the web hub reads a subscriber's catch-up.
 * `github`: what GitHub answers about the repo for this person (their id is in the token the fake receives); by default, "you can read it".
 */
async function setup(opts: { loadItems?: LoadItems; catchUp?: LoadItems; github?: (userId: string) => unknown } = {}) {
  const repo = await makeRepo();
  const github = opts.github ?? (() => ({ id: 1 }));
  const asked = ({ headers }: { headers: Headers }) => github(headers.get('authorization')?.split('ghu_')[1] ?? '');
  const access = new RepoAccess(new GithubClient(fakeFetch({ [`GET /repos/${repo.fullName}`]: asked })));
  const dispatcher = new Dispatcher();
  const cliHub = new CliHub();
  const cliServer = await listen(cliHub);
  const web = await startWebHub({ access, loadItems: opts.catchUp ?? loadItemsAfter });
  const live = wireWebHub({ webHub: web.hub, dispatcher, cliHub, access, debounceMs: DEBOUNCE_MS, ...(opts.loadItems ? { loadItems: opts.loadItems } : {}) });
  stops.push(() => cliServer.close(), () => web.close(), () => live.stop());

  const [maya, leo, reader] = [await makeUser({ login: 'maya' }), await makeUser({ login: 'leo' }), await makeUser({ login: 'rae' })];
  for (const u of [maya, leo, reader]) await makeGithubSignIn(u.id);
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  const tab = async (user: { id: string }, subscribe = true) => {
    const t = await TestTab.open(web.url, { cookie: await sessionCookieFor(user.id), origin: web.origin });
    if (subscribe) {
      t.subscribe(chat.id, 0);
      await t.next('chat.items');
    }
    return t;
  };
  const open = () => dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
  return { repo, chat, maya, leo, reader, dispatcher, cliServer, tab, open };
}

describe('wireWebHub: after a commit (spec §10)', () => {
  it("sends followers the new items in one message and then their own view, and participants their inbox rows", async () => {
    const { chat, maya, leo, reader, tab, open } = await setup();
    const [mayaTab, readerTab, leoTab] = [await tab(maya), await tab(reader), await tab(leo, false)];
    await open();

    const items = await mayaTab.next('chat.items');
    expect(items.d.items.map((i) => i.seq)).toEqual([1, 2]);
    expect((await mayaTab.next('chat.state')).d.view).toMatchObject({ id: chat.id, viewer: { role: 'author' } });
    expect((await mayaTab.next('inbox.upsert')).d.rows.map((r) => r.role)).toEqual(['author']);
    // The items come before the view that follows them. The inbox rows go their own way (not held up by, or holding up, the items).
    expect(mayaTab.log.slice(0, 2)).toEqual(['chat.items', 'chat.items']);
    expect(mayaTab.log.filter((t) => t !== 'inbox.upsert')).toEqual(['chat.items', 'chat.items', 'chat.state']);

    // Someone who reads along: the items and their view, but no inbox row.
    expect((await readerTab.next('chat.items')).d.items).toHaveLength(2);
    expect((await readerTab.next('chat.state')).d.view.viewer.role).toBeNull();
    await readerTab.nothing('inbox.upsert');

    // leo isn't looking at the chat: just his inbox row.
    expect((await leoTab.next('inbox.upsert')).d.rows).toMatchObject([{ chatId: chat.id, role: 'reviewer' }]);
    await leoTab.nothing('chat.items');
  });

  it('sends every item of a burst of commits, and one view for all of them', async () => {
    const { maya, tab, open, dispatcher, chat } = await setup();
    const mayaTab = await tab(maya);
    await open();
    await dispatcher.dispatch(chat.id, { type: 'human_note', author: personOf(maya), body: 'Keep the old endpoint' });
    await mayaTab.next('chat.state');
    await sleep(DEBOUNCE_MS * 3);
    expect(mayaTab.seqs(chat.id)).toEqual([1, 2, 3]);
    expect(mayaTab.log.filter((t) => t === 'chat.state')).toHaveLength(1);
  });
});

describe('wireWebHub: inbox rows only for people who can read the repo', () => {
  const noAccessFor = (names: Record<string, 'none' | 'broken'>) => (userId: string) => {
    const answer = names[userId];
    if (!answer) return { id: 1 };
    return json({ message: answer === 'none' ? 'Not Found' : 'Server Error' }, answer === 'none' ? 404 : 500);
  };

  it('sends someone GitHub says cannot read the repo an empty list (their row goes), and the others their rows', async () => {
    const leoId = { value: '' };
    const { maya, leo, tab, open } = await setup({ github: (userId) => noAccessFor({ [leoId.value]: 'none' })(userId) });
    leoId.value = leo.id;
    const [mayaTab, leoTab] = [await tab(maya, false), await tab(leo, false)];
    await open();
    expect((await mayaTab.next('inbox.upsert')).d.rows.map((r) => r.role)).toEqual(['author']);
    expect((await leoTab.next('inbox.upsert')).d.rows).toEqual([]);
  });

  it('sends nothing to someone whose access check fails on GitHub, and logs it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const leoId = { value: '' };
    const { maya, leo, tab, open } = await setup({ github: (userId) => noAccessFor({ [leoId.value]: 'broken' })(userId) });
    leoId.value = leo.id;
    const [mayaTab, leoTab] = [await tab(maya, false), await tab(leo, false)];
    await open();
    expect((await mayaTab.next('inbox.upsert')).d.rows.map((r) => r.role)).toEqual(['author']);
    await leoTab.nothing('inbox.upsert');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('repo access'), expect.anything());
  });

  it('sends nothing to someone whose GitHub sign-in has expired (the inbox answers them 401 too)', async () => {
    const { maya, leo, tab, open } = await setup();
    await prisma.githubAuth.update({ where: { userId: leo.id }, data: { status: 'needs_reauth' } });
    const [mayaTab, leoTab] = [await tab(maya, false), await tab(leo, false)];
    await open();
    expect((await mayaTab.next('inbox.upsert')).d.rows.map((r) => r.role)).toEqual(['author']);
    await leoTab.nothing('inbox.upsert');
  });

  it("does not hold back a chat's new items while GitHub is slow to answer for someone's inbox row", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const leoId = { value: '' };
    const { maya, leo, chat, tab, open, dispatcher } = await setup({ github: async (userId) => (userId === leoId.value ? gate.then(() => ({ id: 1 })) : { id: 1 }) });
    leoId.value = leo.id;
    try {
      const [mayaTab, leoTab] = [await tab(maya), await tab(leo, false)];
      await open();
      await mayaTab.next('chat.state');
      await dispatcher.dispatch(chat.id, { type: 'human_note', author: personOf(maya), body: 'Keep the old endpoint' });
      await expect.poll(() => mayaTab.seqs(chat.id)).toEqual([1, 2, 3]);
      await leoTab.nothing('inbox.upsert', 50);
      release();
      expect((await leoTab.next('inbox.upsert')).d.rows).toMatchObject([{ chatId: chat.id, role: 'reviewer' }]);
    } finally {
      release();
    }
  });
});

describe('wireWebHub: when the new items cannot be read', () => {
  it('asks the open tabs to resume instead of skipping the items, and the next try gets them', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    let broken = true;
    const { chat, maya, tab, open } = await setup({
      loadItems: async (chatId, afterSeq) => {
        if (broken) throw new Error('database went away');
        return loadItemsAfter(chatId, afterSeq);
      },
    });
    const mayaTab = await tab(maya);
    await open();
    expect((await mayaTab.next('chat.error')).d).toEqual({ chatId: chat.id, code: 'unavailable' });
    expect(mayaTab.seqs(chat.id)).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(chat.id), expect.any(Error));

    // The tab asks again from the newest seq it has (none yet), and the database fills the gap.
    broken = false;
    mayaTab.subscribe(chat.id, 0);
    await expect.poll(() => mayaTab.seqs(chat.id)).toEqual([1, 2]);
  });

  it("does not let a later commit's items through while the tab is still catching up, so it resumes from before the gap", async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    let failOnce = false;
    let hold = false;
    let reached!: () => void;
    const reading = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { chat, maya, tab, open, dispatcher } = await setup({
      loadItems: async (chatId, afterSeq) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('database went away');
        }
        return loadItemsAfter(chatId, afterSeq);
      },
      // The catch-up is read at once, then held back: a commit lands while the tab is still waiting for it.
      catchUp: async (chatId, afterSeq) => {
        const items = await loadItemsAfter(chatId, afterSeq);
        if (hold) {
          reached();
          await gate;
        }
        return items;
      },
    });
    try {
      await open();
      const mayaTab = await tab(maya, false);
      hold = true;
      mayaTab.subscribe(chat.id, 0);
      await reading;

      failOnce = true;
      await dispatcher.dispatch(chat.id, { type: 'human_note', author: personOf(maya), body: 'Keep the old endpoint' });
      await vi.waitFor(() => expect(log).toHaveBeenCalled());
      await dispatcher.dispatch(chat.id, { type: 'human_note', author: personOf(maya), body: 'And the old tests' });
      await sleep(DEBOUNCE_MS * 3);
      release();

      expect((await mayaTab.next('chat.error')).d).toEqual({ chatId: chat.id, code: 'unavailable' });
      expect(mayaTab.seqs(chat.id)).toEqual([1, 2]);
      mayaTab.subscribe(chat.id, 2);
      await expect.poll(() => mayaTab.seqs(chat.id)).toEqual([1, 2, 3, 4]);
    } finally {
      release();
    }
  });
});

describe('wireWebHub: CLIs coming and going', () => {
  it("tells the person, and shows their waiting agent as working once its CLI is back", async () => {
    const { repo, maya, leo, tab, open, cliServer } = await setup();
    const [mayaTab, leoTab] = [await tab(maya), await tab(leo, false)];
    await open();
    expect((await mayaTab.next('chat.state')).d.view.activity).toMatchObject({ kind: 'agent_waiting', who: 'leo', why: 'offline' });

    const { raw } = await makeCliToken(leo.id);
    const cli = await TestCli.online(cliServer.url, raw, { repos: [repo.fullName] });
    expect((await leoTab.next('me.update')).d.me).toMatchObject({ login: 'leo', agentOnline: true });
    expect((await mayaTab.next('chat.state')).d.view.activity).toEqual({ kind: 'agent_working', who: 'leo', why: null, offlineSince: null });

    cli.close();
    expect((await leoTab.next('me.update')).d.me.agentOnline).toBe(false);
  });

  it("shows an agent coming and going in a chat someone has open, even with no work queued for it", async () => {
    const { repo, maya, tab, open, cliServer } = await setup();
    const mayaTab = await tab(maya);
    await open();
    const agentOf = (view: { participants: { login: string; agent: { online: boolean } | null }[] }) => view.participants.find((p) => p.login === 'maya')?.agent?.online;
    expect(agentOf((await mayaTab.next('chat.state')).d.view)).toBe(false);

    // maya wrote the PR: nothing waits for her agent until leo's review is in.
    const { raw } = await makeCliToken(maya.id);
    const cli = await TestCli.online(cliServer.url, raw, { repos: [repo.fullName] });
    expect(agentOf((await mayaTab.next('chat.state')).d.view)).toBe(true);

    cli.close();
    expect(agentOf((await mayaTab.next('chat.state')).d.view)).toBe(false);
  });
});

describe('wireWebHub: progress lines', () => {
  it("forwards a CLI's progress to the chat's followers, as whose agent and doing what", async () => {
    const { repo, chat, maya, leo, tab, open, cliServer } = await setup();
    const [mayaTab, leoTab] = [await tab(maya), await tab(leo, false)];
    await open();
    const job = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id, userId: leo.id } });
    const cli = await TestCli.online(cliServer.url, (await makeCliToken(leo.id)).raw, { repos: [repo.fullName] });
    cli.send({ v: 1, t: 'job.progress', d: { jobId: job.id, attempt: 1, stage: 'running_agent', text: 'reading src/orders.ts' } });
    expect((await mayaTab.next('job.progress')).d).toEqual({ chatId: chat.id, who: 'leo', action: 'reviewing', stage: 'running_agent', text: 'reading src/orders.ts' });
    await leoTab.nothing('job.progress');
  });

  it("drops progress a CLI sends for someone else's job", async () => {
    const { repo, chat, maya, leo, tab, open, cliServer } = await setup();
    const mayaTab = await tab(maya);
    await open();
    const leosJob = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id, userId: leo.id } });
    const mayasCli = await TestCli.online(cliServer.url, (await makeCliToken(maya.id)).raw, { repos: [repo.fullName] });
    mayasCli.send({ v: 1, t: 'job.progress', d: { jobId: leosJob.id, attempt: 1, stage: 'running_agent', text: 'pretending to be leo' } });
    await mayaTab.nothing('job.progress');
  });
});
