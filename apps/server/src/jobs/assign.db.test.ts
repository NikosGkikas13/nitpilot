import { LEASE_SEC } from '@nitpilot/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeChat, makeCliToken, makeRepo, makeUser, personOf, resetDb } from '../../test/db';
import { sleep, startCliServer, TestCli, type CliServer } from '../../test/ws';
import { prisma } from '../lib/prisma';

// The assigner looks at every queued job, so each test starts from an empty database.
let s: CliServer;
let clock: Date;
beforeEach(async () => {
  await resetDb();
  clock = new Date();
  s = await startCliServer({ now: () => clock });
});
afterEach(() => s.close());

type User = Awaited<ReturnType<typeof makeUser>>;

/** A job written straight into the table, the way apply-commands.ts writes one, without the engine. */
async function queueJob(chatId: string, user: User, role: 'author' | 'reviewer', type: 'review' | 'address') {
  const p = await prisma.participant.upsert({
    where: { chatId_githubId_role: { chatId, githubId: user.githubId, role } },
    create: { chatId, githubId: user.githubId, login: user.login, role, userId: user.id, requested: role === 'reviewer' },
    update: {},
  });
  return prisma.job.create({ data: { chatId, participantId: p.id, activeFor: p.id, userId: user.id, type, round: 1, headSha: 'a'.repeat(40), runAfter: clock } });
}

/** leo, with a review job queued on a fresh repo. */
async function leoWithAJob() {
  const leo = await makeUser({ login: 'leo' });
  const repo = await makeRepo();
  const chat = await makeChat(repo.id);
  return { leo, repo, chat, job: await queueJob(chat.id, leo, 'reviewer', 'review') };
}

async function online(user: User, over: Parameters<typeof TestCli.online>[2] = {}) {
  return TestCli.online(s.url, (await makeCliToken(user.id)).raw, over);
}

const statusOf = async (jobId: string) => (await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status;

describe('JobAssigner', () => {
  it("gives a queued job to its owner's CLI when it connects: running, attempt 1, a 90-second lease", async () => {
    const { leo, repo, job } = await leoWithAJob();
    const cli = await online(leo, { repos: [repo.fullName] });
    expect((await cli.next('job.assign')).d.bundle).toMatchObject({ jobId: job.id, attempt: 1, type: 'review' });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'running',
      attempt: 1,
      cliTokenId: s.hub.connectionsFor(leo.id)[0]!.tokenId,
      leaseExpiresAt: new Date(clock.getTime() + LEASE_SEC * 1000),
    });
  });

  it('hands out a job the engine queues while the CLI is already online', async () => {
    const maya = await makeUser({ login: 'maya' });
    const leo = await makeUser({ login: 'leo' });
    const repo = await makeRepo();
    const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
    const cli = await online(leo, { repos: [repo.fullName] });
    await s.dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
    expect((await cli.next('job.assign')).d.bundle).toMatchObject({ type: 'review', you: { login: 'leo', role: 'reviewer' } });
  });

  it("never gives a job to someone else's CLI", async () => {
    const { repo, job } = await leoWithAJob();
    const mayasCli = await online(await makeUser({ login: 'maya' }), { repos: [repo.fullName] });
    await s.settle();
    await mayasCli.nothing('job.assign');
    expect(await statusOf(job.id)).toBe('queued');
  });

  it("leaves the job queued while none of the owner's CLIs has the repo linked", async () => {
    const { leo, job } = await leoWithAJob();
    const cli = await online(leo, { repos: ['someone/else'] });
    await s.settle();
    await cli.nothing('job.assign');
    expect(await statusOf(job.id)).toBe('queued');
  });

  it("doesn't give an address job to a CLI whose agent can only review", async () => {
    const maya = await makeUser({ login: 'maya' });
    const repo = await makeRepo();
    const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
    const job = await queueJob(chat.id, maya, 'author', 'address');
    const cli = await online(maya, { repos: [repo.fullName], agent: { id: 'fake', version: null, modes: ['reviewer'] } });
    await s.settle();
    await cli.nothing('job.assign');
    expect(await statusOf(job.id)).toBe('queued');
  });

  it('never gives a CLI more jobs than its concurrency, and sends the next one when a slot frees up', async () => {
    const leo = await makeUser({ login: 'leo' });
    const repo = await makeRepo();
    const first = await queueJob((await makeChat(repo.id)).id, leo, 'reviewer', 'review');
    const second = await queueJob((await makeChat(repo.id)).id, leo, 'reviewer', 'review');
    const cli = await online(leo, { repos: [repo.fullName], concurrency: 1 });
    expect((await cli.next('job.assign')).d.bundle.jobId).toBe(first.id);
    await s.settle();
    await cli.nothing('job.assign');
    await prisma.job.update({ where: { id: first.id }, data: { status: 'done', activeFor: null } });
    await s.assigner.tick();
    expect((await cli.next('job.assign')).d.bundle.jobId).toBe(second.id);
  });

  it("gives a job to exactly one of a user's CLIs, even when two passes race", async () => {
    const leo = await makeUser({ login: 'leo' });
    const repo = await makeRepo();
    const laptop = await online(leo, { device: 'laptop', repos: [repo.fullName] });
    const desktop = await online(leo, { device: 'desktop', repos: [repo.fullName] });
    await s.settle();
    const job = await queueJob((await makeChat(repo.id)).id, leo, 'reviewer', 'review');
    expect((await Promise.all([s.assigner.assignDue(), s.assigner.assignDue()])).sort()).toEqual([0, 1]);
    await sleep(300);
    expect(laptop.count('job.assign') + desktop.count('job.assign')).toBe(1);
    expect(await statusOf(job.id)).toBe('running');
  });

  it('runs one pass at a time, so wake-ups that race never go over the concurrency', async () => {
    const leo = await makeUser({ login: 'leo' });
    const repo = await makeRepo();
    const cli = await online(leo, { repos: [repo.fullName], concurrency: 1 });
    await s.settle();
    await queueJob((await makeChat(repo.id)).id, leo, 'reviewer', 'review');
    await queueJob((await makeChat(repo.id)).id, leo, 'reviewer', 'review');
    await Promise.all([s.assigner.tick(), s.assigner.tick()]);
    await sleep(300);
    expect(cli.count('job.assign')).toBe(1);
  });

  it('waits until runAfter', async () => {
    const { leo, repo, job } = await leoWithAJob();
    await prisma.job.update({ where: { id: job.id }, data: { runAfter: new Date(clock.getTime() + 60_000) } });
    const cli = await online(leo, { repos: [repo.fullName] });
    await s.settle();
    await cli.nothing('job.assign');
    clock = new Date(clock.getTime() + 60_000);
    await s.assigner.tick();
    expect((await cli.next('job.assign')).d.bundle.jobId).toBe(job.id);
  });

  it("moves a queued job to the PR's latest head when it hands it out", async () => {
    const { leo, repo, chat, job } = await leoWithAJob();
    // A push arrived while the job waited in the queue.
    await prisma.prChat.update({ where: { id: chat.id }, data: { headSha: 'c'.repeat(40) } });
    const cli = await online(leo, { repos: [repo.fullName] });
    expect((await cli.next('job.assign')).d.bundle.pr.headSha).toBe('c'.repeat(40));
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).headSha).toBe('c'.repeat(40));
  });
});
