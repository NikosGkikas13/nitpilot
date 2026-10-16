import { afterEach, describe, expect, it } from 'vitest';
import { makeChat, makeCliToken, makeGithubSignIn, makeRepo, makeUser, personOf } from '../../test/db';
import { fakeFetch } from '../../test/fake-fetch';
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
  for (const stop of stops.splice(0).reverse()) await stop();
});

/** The server's live side, wired as main.ts wires it: a dispatcher, a CLI hub and a web hub. maya's PR, leo asked to review. */
async function setup() {
  const repo = await makeRepo();
  const access = new RepoAccess(new GithubClient(fakeFetch({ [`GET /repos/${repo.fullName}`]: () => ({ id: 1 }) })));
  const dispatcher = new Dispatcher();
  const cliHub = new CliHub();
  const cliServer = await listen(cliHub);
  const web = await startWebHub({ access, loadItems: loadItemsAfter });
  const live = wireWebHub({ webHub: web.hub, dispatcher, cliHub, access, debounceMs: DEBOUNCE_MS });
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
    expect(mayaTab.log).toEqual(['chat.items', 'chat.items', 'chat.state', 'inbox.upsert']);

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
