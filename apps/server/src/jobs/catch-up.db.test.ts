import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChat, makeCliToken, resetDb } from '../../test/db';
import { people, pull } from '../../test/fixtures/github';
import { startCliServer, TestCli, type CliServer } from '../../test/ws';
import { Dispatcher } from '../chats/dispatch';
import { routePrEvent } from '../chats/route-event';
import { syncFromEvent } from '../ingest/installations';
import { prisma } from '../lib/prisma';
import { FakePlatform } from '../platform/fake/fake-platform';
import { snapshotFromPull } from '../platform/github/mapping';
import { CatchUp } from './catch-up';

beforeEach(resetDb);

const ref = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 };

/**
 * The app is on octo/sandbox, maya and leo use Nitpilot, and maya opened PR 42 asking leo to review
 * it while the server was down: GitHub (`platform`) has it, Nitpilot has no chat for it.
 */
async function setup(platform = new FakePlatform()) {
  await syncFromEvent({ scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [{ id: '501', fullName: 'octo/sandbox', private: false, defaultBranch: 'main' }] });
  await prisma.user.create({ data: { githubId: String(people.maya.id), login: 'maya' } });
  const leo = await prisma.user.create({ data: { githubId: String(people.leo.id), login: 'leo' } });
  platform.addPr(snapshotFromPull(ref, pull()));
  platform.openPrs.set(leo.id, [{ repoFullName: 'octo/sandbox', number: 42 }]);
  return { leo, platform, catchUp: new CatchUp({ platform, dispatch: new Dispatcher().dispatch }) };
}

const chats = () => prisma.prChat.findMany({ include: { jobs: true } });

describe('catching up when a CLI connects (spec §15)', () => {
  it('starts a chat for an open PR Nitpilot never saw, as if it had just been opened', async () => {
    const { leo, catchUp } = await setup();
    expect(await catchUp.forUser(leo)).toBe(1);
    const [chat] = await chats();
    expect(chat).toMatchObject({ number: 42, phase: 'reviewing' });
    expect(chat!.jobs).toEqual([expect.objectContaining({ type: 'review', userId: leo.id })]);
  });

  it('does not say "opened" twice when a webhook creates the chat while the catch-up is reading the PR', async () => {
    const { leo, platform, catchUp } = await setup();
    const realGetPr = platform.getPr.bind(platform);
    // The webhook for the same PR lands in the catch-up's gap between "no chat yet" and "start one".
    vi.spyOn(platform, 'getPr').mockImplementationOnce(async (r) => {
      const snapshot = await realGetPr(r);
      await routePrEvent({ scope: 'pr', pr: ref, snapshot, event: { type: 'pr_opened', author: snapshot.author, reviewers: snapshot.requestedReviewers } }, { platform, dispatch: new Dispatcher().dispatch });
      return snapshot;
    });
    await catchUp.forUser(leo); // resolves 1: the count includes the PR the webhook started
    expect(await chats()).toHaveLength(1);
    const opened = await prisma.message.findMany({ where: { body: { startsWith: 'Pull request opened by' } } });
    expect(opened).toHaveLength(1);
  });

  it('searches once per person per server start', async () => {
    const { leo, platform, catchUp } = await setup();
    await catchUp.forUser(leo);
    expect(await catchUp.forUser(leo)).toBe(0);
    expect(platform.searches).toEqual([leo.id]);
    expect(await chats()).toHaveLength(1);
  });

  it("skips a PR it already has a chat for, a repo the app isn't on, and a PR closed since the search", async () => {
    const { leo, platform, catchUp } = await setup();
    await makeChat('501', { number: 42 });
    platform.addPr(snapshotFromPull({ ...ref, number: 43 }, pull({ number: 43, state: 'closed' })));
    platform.openPrs.set(leo.id, [
      { repoFullName: 'octo/sandbox', number: 42 },
      { repoFullName: 'someone/elsewhere', number: 1 },
      { repoFullName: 'octo/sandbox', number: 43 },
    ]);
    expect(await catchUp.forUser(leo)).toBe(0);
    expect((await chats()).map((c) => c.number)).toEqual([42]);
    expect(await prisma.message.count()).toBe(0);
  });

  it('shares one catch-up between two hellos at once', async () => {
    const { leo, platform, catchUp } = await setup();
    expect(await Promise.all([catchUp.forUser(leo), catchUp.forUser(leo)])).toEqual([1, 1]);
    expect(platform.searches).toEqual([leo.id]);
    expect(await chats()).toHaveLength(1);
  });

  it("doesn't let one PR that can't be read stop the others", async () => {
    const { leo, platform, catchUp } = await setup();
    platform.addPr(snapshotFromPull({ ...ref, number: 43 }, pull({ number: 43 })));
    platform.openPrs.set(leo.id, [
      { repoFullName: 'octo/sandbox', number: 42 },
      { repoFullName: 'octo/sandbox', number: 43 },
    ]);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const realGetPr = platform.getPr.bind(platform);
    vi.spyOn(platform, 'getPr').mockImplementation((r) => (r.number === 42 ? Promise.reject(new Error('PR 42 was deleted')) : realGetPr(r)));
    expect(await catchUp.forUser(leo)).toBe(1);
    expect((await chats()).map((c) => c.number)).toEqual([43]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('#42'), expect.any(Error));
  });

  it('tries again on the next hello when the search failed', async () => {
    const { leo, platform, catchUp } = await setup();
    vi.spyOn(platform, 'findOpenPrsFor').mockRejectedValueOnce(new Error('GitHub is down'));
    await expect(catchUp.forUser(leo)).rejects.toThrow('GitHub is down');
    expect(await catchUp.forUser(leo)).toBe(1);
  });

  describe('wired to the CLI hub', () => {
    let s: CliServer | null = null;
    afterEach(async () => {
      await s?.close();
      s = null;
    });

    it("a CLI's hello catches its owner up, and the review it queued comes back to that CLI", async () => {
      s = await startCliServer();
      const { leo } = await setup(s.platform);
      const token = await makeCliToken(leo.id);
      const cli = await TestCli.online(s.url, token.raw, { repos: ['octo/sandbox'] });
      const assign = await cli.next('job.assign');
      expect(assign.d.bundle.pr).toMatchObject({ repoFullName: 'octo/sandbox', number: 42 });
      cli.close();
    });
  });
});
