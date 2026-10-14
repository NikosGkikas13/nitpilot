import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb } from '../../test/db';
import { issueCommentEvent, people, prEvent, pull, repository, repositoryEvent, reviewComment, reviewCommentEvent, reviewEvent } from '../../test/fixtures/github';
import { createDeliveryHandler } from '../ingest/handle';
import { syncFromEvent } from '../ingest/installations';
import { summaryMarker } from '../lib/markers';
import { prisma } from '../lib/prisma';
import { FakePlatform } from '../platform/fake/fake-platform';
import { snapshotFromPull } from '../platform/github/mapping';
import { Dispatcher } from './dispatch';

beforeEach(resetDb);

const ref = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 };

async function setup() {
  await syncFromEvent({ scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [{ id: '501', fullName: 'octo/sandbox', private: false, defaultBranch: 'main' }] });
  const maya = await prisma.user.create({ data: { githubId: String(people.maya.id), login: 'maya' } });
  const leo = await prisma.user.create({ data: { githubId: String(people.leo.id), login: 'leo' } });
  const platform = new FakePlatform();
  platform.addPr(snapshotFromPull(ref, pull()));
  const dispatcher = new Dispatcher();
  const handle = createDeliveryHandler({ platform, dispatch: dispatcher.dispatch });
  let n = 0;
  const deliver = (event: string, payload: unknown) => handle({ deliveryId: `d-${++n}`, event, body: JSON.stringify(payload) });
  return { maya, leo, platform, deliver };
}

const chat = () => prisma.prChat.findUniqueOrThrow({ where: { repoId_number: { repoId: '501', number: 42 } }, include: { points: true, jobs: true, participants: true } });

afterEach(() => vi.unstubAllEnvs());

describe('routing PR events', () => {
  it('creates the chat and queues a review for a reviewer on Nitpilot', async () => {
    const { leo, deliver } = await setup();
    expect(await deliver('pull_request', prEvent('opened'))).toEqual({ status: 'processed' });
    const c = await chat();
    expect(c).toMatchObject({ phase: 'reviewing', trusted: true, title: 'Cursor pagination for orders' });
    expect(c.jobs).toEqual([expect.objectContaining({ type: 'review', userId: leo.id })]);
  });

  it('builds a chat it has never seen from the API, starting with pr_opened', async () => {
    const { deliver } = await setup();
    await deliver('pull_request_review_comment', reviewCommentEvent('created'));
    const c = await chat();
    expect(c.participants.map((p) => p.login)).toEqual(expect.arrayContaining(['maya', 'leo', 'sam']));
    expect(c.points).toEqual([expect.objectContaining({ githubCommentId: '9001', origin: 'github' })]);
  });

  it('reads .nitpilot.yml when a round may start, and remembers a broken one', async () => {
    const { platform, deliver } = await setup();
    platform.files.set('octo/sandbox:.nitpilot.yml', 'max_rounds: 99\n');
    await deliver('pull_request', prEvent('opened'));
    const repo = await prisma.repo.findUniqueOrThrow({ where: { id: '501' } });
    expect(repo.rulesJson).toBeNull();
    expect(repo.rulesError).toMatch(/max_rounds/);
  });

  it('trusts the bots listed in trusted_bots', async () => {
    const { deliver } = await setup();
    await deliver('pull_request', prEvent('opened'));
    await deliver('pull_request_review_comment', reviewCommentEvent('created', reviewComment({ id: 9300, user: people.rabbit, author_association: 'NONE' })));
    expect((await chat()).points.find((p) => p.githubCommentId === '9300')!.trusted).toBe(true);
  });

  it('ignores events for repos it does not know, and private repos in public-only mode', async () => {
    const { deliver } = await setup();
    const other = { ...prEvent('opened'), repository: { id: 999, full_name: 'x/y', private: false } };
    expect(await deliver('pull_request', other)).toMatchObject({ status: 'ignored', note: expect.stringMatching(/unknown repo/) });

    vi.stubEnv('PUBLIC_REPOS_ONLY', 'true');
    const secret = { ...prEvent('opened'), repository: { id: 501, full_name: 'octo/sandbox', private: true } };
    expect(await deliver('pull_request', secret)).toMatchObject({ status: 'ignored', note: expect.stringMatching(/private/) });
  });

  it('purges the chats and jobs of a repo made private, in public-only mode', async () => {
    const { deliver } = await setup();
    await deliver('pull_request', prEvent('opened'));
    expect(await prisma.job.count()).toBe(1);

    vi.stubEnv('PUBLIC_REPOS_ONLY', 'true');
    expect(await deliver('repository', repositoryEvent('privatized', { ...repository, private: true }))).toEqual({ status: 'processed' });
    expect(await prisma.prChat.count()).toBe(0);
    expect(await prisma.job.count()).toBe(0);
    expect((await prisma.repo.findUniqueOrThrow({ where: { id: '501' } })).private).toBe(true);
  });
});

describe('our own writes coming back (Review Focus #1)', () => {
  it('ignores a comment carrying our marker', async () => {
    const { deliver } = await setup();
    await deliver('pull_request', prEvent('opened'));
    const c = await chat();
    const res = await deliver('issue_comment', issueCommentEvent('created', { id: 8100, user: people.bot, body: `${summaryMarker(c.id)}\n🤖 Nitpilot …` }));
    expect(res).toMatchObject({ status: 'ignored', note: expect.stringMatching(/our own/) });
    expect((await chat()).points).toEqual([]);
  });

  it('ignores a comment or review whose id we recorded as ours', async () => {
    const { deliver } = await setup();
    await deliver('pull_request', prEvent('opened'));
    const c = await chat();
    await prisma.githubWrite.createMany({ data: [{ chatId: c.id, kind: 'reply', githubId: '9400' }, { chatId: c.id, kind: 'review', githubId: '7400' }] });
    expect(await deliver('pull_request_review_comment', reviewCommentEvent('created', reviewComment({ id: 9400 })))).toMatchObject({ status: 'ignored' });
    expect(await deliver('pull_request_review', reviewEvent('COMMENTED', { id: 7400, body: 'from our agent' }))).toMatchObject({ status: 'ignored' });
  });

  it('marks a push we announced as ours', async () => {
    const { deliver } = await setup();
    await deliver('pull_request', prEvent('opened'));
    const c = await chat();
    await prisma.job.updateMany({ where: { chatId: c.id }, data: { expectedPushSha: 'c'.repeat(40) } });
    await deliver('pull_request', prEvent('synchronize', { before: 'a'.repeat(40), after: 'c'.repeat(40) }));
    const after = await chat();
    expect(after.headSha).toBe('c'.repeat(40));
    expect(await prisma.message.count({ where: { chatId: c.id, body: { startsWith: 'New commits pushed' } } })).toBe(0);
  });
});

describe('a comment that arrives twice (Review Focus #3)', () => {
  it('becomes one point whether it comes alone or inside a review', async () => {
    const { platform, deliver } = await setup();
    await deliver('pull_request', prEvent('opened'));
    await deliver('pull_request_review_comment', reviewCommentEvent('created', reviewComment({ id: 9500 })));
    platform.reviewComments.set('7500', [reviewComment({ id: 9500 })]);
    await deliver('pull_request_review', reviewEvent('CHANGES_REQUESTED', { id: 7500 }));
    expect((await chat()).points.filter((p) => p.githubCommentId === '9500')).toHaveLength(1);
  });

  it('records a reply once whether it comes alone or inside a review', async () => {
    const { platform, deliver } = await setup();
    await deliver('pull_request', prEvent('opened'));
    await deliver('pull_request_review_comment', reviewCommentEvent('created', reviewComment({ id: 9600 })));
    const reply = reviewComment({ id: 9601, in_reply_to_id: 9600, body: 'Still empty on page 2.' });
    await deliver('pull_request_review_comment', reviewCommentEvent('created', reply));
    platform.reviewComments.set('7600', [reply]);
    await deliver('pull_request_review', reviewEvent('COMMENTED', { id: 7600 }));
    expect(await prisma.message.count({ where: { body: 'Still empty on page 2.' } })).toBe(1);
  });

  it('is still handled when its first delivery failed on a GitHub error and is retried', async () => {
    const { platform, deliver } = await setup();
    // The chat doesn't exist yet, so the router reads the PR from GitHub, which fails once.
    vi.spyOn(platform, 'getPr').mockRejectedValueOnce(new Error('GitHub 502'));
    const event = reviewCommentEvent('created', reviewComment({ id: 9700 }));
    await expect(deliver('pull_request_review_comment', event)).rejects.toThrow('GitHub 502');

    expect(await deliver('pull_request_review_comment', event)).toEqual({ status: 'processed' });
    expect((await chat()).points.map((p) => p.githubCommentId)).toEqual(['9700']);
  });
});

describe('a PR that is already tracked', () => {
  it('says "opened" once: a second pr_opened (a redelivery, or a catch-up that met it first) is ignored', async () => {
    const { deliver } = await setup();
    expect(await deliver('pull_request', prEvent('opened'))).toEqual({ status: 'processed' });
    expect(await deliver('pull_request', prEvent('opened'))).toEqual({ status: 'ignored', note: 'opened PR that is already tracked' });
    const messages = await prisma.message.findMany({ where: { chatId: (await chat()).id } });
    expect(messages.filter((m) => m.body.startsWith('Pull request opened by'))).toHaveLength(1);
  });
});

describe('a base retarget (pull_request.edited)', () => {
  const retarget = (over: Parameters<typeof pull>[0] = {}) =>
    prEvent('edited', {
      pull: { base: { sha: 'c'.repeat(40), ref: 'release', repo: repository }, ...over },
      changes: { base: { ref: { from: 'main' }, sha: { from: 'b'.repeat(40) } } },
    });

  it('refreshes the base, checks trust again and says so in the chat', async () => {
    const { deliver } = await setup();
    await deliver('pull_request', prEvent('opened'));
    expect(await deliver('pull_request', retarget({ author_association: 'CONTRIBUTOR' }))).toEqual({ status: 'processed' });
    const c = await chat();
    expect(c).toMatchObject({ baseRef: 'release', baseSha: 'c'.repeat(40), trusted: false });
    const last = await prisma.message.findFirstOrThrow({ where: { chatId: c.id }, orderBy: { seq: 'desc' } });
    expect(last.body).toBe('Now targets release');
  });

  it('keeps a PR from a bot the team trusts trusted', async () => {
    const { deliver } = await setup();
    await deliver('pull_request', prEvent('opened', { pull: { user: people.rabbit, author_association: 'NONE' } }));
    await deliver('pull_request', retarget({ user: people.rabbit, author_association: 'NONE' }));
    expect(await chat()).toMatchObject({ baseRef: 'release', trusted: true });
  });

  it('ignores an edit that only changes the title', async () => {
    const { deliver } = await setup();
    await deliver('pull_request', prEvent('opened'));
    const retitled = prEvent('edited', { pull: { title: 'Keyset pagination' }, changes: { title: { from: 'Cursor pagination for orders' } } });
    expect(await deliver('pull_request', retitled)).toEqual({ status: 'ignored', note: 'nothing to do for pull_request.edited' });
    expect(await chat()).toMatchObject({ baseRef: 'main', baseSha: 'b'.repeat(40), trusted: true });
  });
});
