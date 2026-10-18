import type { JobResult, RunningJob } from '@nitpilot/protocol';
import * as samples from '@nitpilot/protocol/test-samples';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChat, makeCliToken, makeRepo, makeUser, personOf, resetDb } from '../../test/db';
import { startCliServer, TestCli, type CliServer } from '../../test/ws';
import { pull } from '../../test/fixtures/github';
import { prRefOf } from '../chats/refs';
import { prisma } from '../lib/prisma';
import { snapshotFromPull } from '../platform/github/mapping';
import type { PrSnapshot } from '../platform/types';

let s: CliServer;
let clock: Date;
const later = (ms: number) => new Date(clock.getTime() + ms);

beforeEach(async () => {
  await resetDb();
  clock = new Date();
  s = await startCliServer({ now: () => clock });
});
afterEach(async () => {
  try {
    await s.close();
  } finally {
    vi.restoreAllMocks();
  }
});

const complete = (job: RunningJob, result: JobResult, id = 'c1') => ({ v: 1, t: 'job.complete', id, d: { ...job, result } });
const pointsIn = (chatId: string) => prisma.point.count({ where: { chatId } });

/** What GitHub would say about this chat's PR, as it is in the database. */
async function snapshotOf(chatId: string): Promise<PrSnapshot> {
  const chat = await prisma.prChat.findUniqueOrThrow({ where: { id: chatId }, include: { repo: true } });
  return { ...snapshotFromPull(prRefOf(chat), pull({ number: chat.number })), headSha: chat.headSha };
}

/** maya's PR; both are online with the repo linked; leo's review job is running on leo's CLI. */
async function reviewing() {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const repo = await makeRepo();
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  const mayaCli = await TestCli.online(s.url, (await makeCliToken(maya.id)).raw, { repos: [repo.fullName] });
  const leoCli = await TestCli.online(s.url, (await makeCliToken(leo.id)).raw, { repos: [repo.fullName] });
  await s.dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
  const { bundle } = (await leoCli.next('job.assign')).d;
  const job: RunningJob = { jobId: bundle.jobId, attempt: bundle.attempt };
  return { chat, mayaCli, leoCli, job, row: () => prisma.job.findUniqueOrThrow({ where: { id: job.jobId } }) };
}

/** leo's review raised P1; maya's address job is running on maya's CLI. */
async function addressing() {
  const scene = await reviewing();
  scene.leoCli.send(complete(scene.job, samples.jobResult()));
  await scene.leoCli.next('ack');
  const { bundle } = (await scene.mayaCli.next('job.assign')).d;
  const address: RunningJob = { jobId: bundle.jobId, attempt: bundle.attempt };
  return { ...scene, address, addressRow: () => prisma.job.findUniqueOrThrow({ where: { id: address.jobId } }) };
}

describe('job.complete', () => {
  it("applies the result and starts the next step: leo's point goes to maya's agent", async () => {
    const { chat, mayaCli, leoCli, job, row } = await reviewing();
    leoCli.send(complete(job, samples.jobResult()));
    expect(await leoCli.next('ack')).toMatchObject({ re: 'c1', d: { status: 'applied' } });
    expect(await row()).toMatchObject({ status: 'done', applyState: 'applied' });
    expect(await pointsIn(chat.id)).toBe(1);
    expect((await mayaCli.next('job.assign')).d.bundle).toMatchObject({ type: 'address', points: [expect.objectContaining({ number: 1 })] });
  });

  it('acks a result from another attempt as stale and changes nothing', async () => {
    const { chat, leoCli, job, row } = await reviewing();
    leoCli.send(complete({ ...job, attempt: job.attempt + 1 }, samples.jobResult()));
    expect((await leoCli.next('ack')).d).toEqual({ status: 'stale' });
    expect((await row()).status).toBe('running');
    expect(await pointsIn(chat.id)).toBe(0);
  });

  it("acks a result for a job running on someone else's CLI as stale", async () => {
    const { chat, mayaCli, job, row } = await reviewing();
    mayaCli.send(complete(job, samples.jobResult()));
    expect((await mayaCli.next('ack')).d).toEqual({ status: 'stale' });
    expect((await row()).status).toBe('running');
    expect(await pointsIn(chat.id)).toBe(0);
  });

  it('applies a result sent twice only once: the second gets stale', async () => {
    const { chat, leoCli, job } = await reviewing();
    leoCli.send(complete(job, samples.jobResult(), 'c1'));
    expect((await leoCli.next('ack')).d).toEqual({ status: 'applied' });
    leoCli.send(complete(job, samples.jobResult(), 'c2'));
    expect(await leoCli.next('ack')).toMatchObject({ re: 'c2', d: { status: 'stale' } });
    expect(await pointsIn(chat.id)).toBe(1);
  });
});

describe('job.pushing', () => {
  it('records the commit about to be pushed, so its webhook is recognized as ours, and acks', async () => {
    const { mayaCli, address, addressRow } = await addressing();
    mayaCli.send({ v: 1, t: 'job.pushing', id: 'p1', d: { ...address, from: 'a'.repeat(40), to: 'c'.repeat(40) } });
    expect(await mayaCli.next('ack')).toMatchObject({ re: 'p1', d: { status: 'applied' } });
    expect((await addressRow()).expectedPushSha).toBe('c'.repeat(40));
  });

  it('acks a push from another attempt as stale and records nothing: that CLI must not push', async () => {
    const { mayaCli, address, addressRow } = await addressing();
    mayaCli.send({ v: 1, t: 'job.pushing', id: 'p1', d: { ...address, attempt: address.attempt + 1, from: 'a'.repeat(40), to: 'c'.repeat(40) } });
    expect((await mayaCli.next('ack')).d).toEqual({ status: 'stale' });
    expect((await addressRow()).expectedPushSha).toBeNull();
  });
});

describe('job.fail and job.reject', () => {
  it('put a retryable failure back in the queue after a delay', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { leoCli, job, row } = await reviewing();
    leoCli.send({ v: 1, t: 'job.fail', id: 'f1', d: { ...job, reason: 'crash', retryable: true, detail: 'claude exited with code 1' } });
    expect((await leoCli.next('ack')).d).toEqual({ status: 'applied' });
    expect(await row()).toMatchObject({ status: 'queued', attempt: 1, cliTokenId: null, runAfter: later(30_000) });
    // The CLI's own explanation goes to the server log, with who, which attempt and what the server made of it.
    expect(warned).toHaveBeenCalledWith(`[cli] leo/test laptop: job ${job.jobId} attempt 1 failed (crash, ack applied): "claude exited with code 1"`);
  });

  it('fail the job for good on a final failure, flag its owner and queue a notification', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { chat, leoCli, job, row } = await reviewing();
    leoCli.send({ v: 1, t: 'job.fail', id: 'f1', d: { ...job, reason: 'auth', retryable: false, detail: 'claude is not logged in' } });
    expect((await leoCli.next('ack')).d).toEqual({ status: 'applied' });
    expect(warned).toHaveBeenCalledWith(`[cli] leo/test laptop: job ${job.jobId} attempt 1 failed (auth, ack applied): "claude is not logged in"`);
    expect(await row()).toMatchObject({ status: 'failed', failure: 'auth' });
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, role: 'reviewer' } })).toMatchObject({ attention: 'failed' });
    expect(await prisma.task.count({ where: { chatId: chat.id, kind: 'notify' } })).toBe(1);
  });

  it("after stale_head, moves the chat to the head GitHub really has, so the next try fetches that one", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { chat, leoCli, job, row } = await reviewing();
    // A late, older push webhook left the chat on an old head; GitHub's PR is on 'e…'.
    s.platform.addPr({ ...(await snapshotOf(chat.id)), headSha: 'e'.repeat(40) });
    leoCli.send({ v: 1, t: 'job.fail', id: 'f1', d: { ...job, reason: 'stale_head', retryable: true, detail: "The PR's head is eeeeeee now, not aaaaaaa." } });
    expect((await leoCli.next('ack')).d).toEqual({ status: 'applied' });
    await s.settle();
    expect((await prisma.prChat.findUniqueOrThrow({ where: { id: chat.id } })).headSha).toBe('e'.repeat(40));

    clock = later(5_000);
    await s.settle();
    expect((await leoCli.next('job.assign')).d.bundle).toMatchObject({ jobId: job.jobId, pr: { headSha: 'e'.repeat(40) } });
    expect(await row()).toMatchObject({ status: 'running', headSha: 'e'.repeat(40) });
  });

  it('after stale_head, leaves the chat alone when GitHub agrees with it (its pull ref only lagged)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { chat, leoCli, job } = await reviewing();
    s.platform.addPr(await snapshotOf(chat.id));
    const before = await prisma.message.count({ where: { chatId: chat.id } });
    leoCli.send({ v: 1, t: 'job.fail', id: 'f1', d: { ...job, reason: 'stale_head', retryable: true, detail: 'lagging' } });
    expect((await leoCli.next('ack')).d).toEqual({ status: 'applied' });
    await s.settle();
    expect((await prisma.prChat.findUniqueOrThrow({ where: { id: chat.id } })).headSha).toBe(chat.headSha);
    expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(before);
  });

  it("still acks stale_head when GitHub can't be asked, and logs why", async () => {
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { leoCli, job, row } = await reviewing(); // no PR in the fake platform: getPr throws
    leoCli.send({ v: 1, t: 'job.fail', id: 'f1', d: { ...job, reason: 'stale_head', retryable: true, detail: 'moved' } });
    expect((await leoCli.next('ack')).d).toEqual({ status: 'applied' });
    await s.settle();
    expect(await row()).toMatchObject({ status: 'queued', refundedAttempts: 1 });
    expect(failed).toHaveBeenCalledWith(expect.stringContaining('[stale_head]'), expect.anything());
  });

  it('wait an hour after a daily-cap rejection, without using up an attempt', async () => {
    const { leoCli, job, row } = await reviewing();
    leoCli.send({ v: 1, t: 'job.reject', id: 'r1', d: { ...job, reason: 'daily_cap' } });
    expect((await leoCli.next('ack')).d).toEqual({ status: 'applied' });
    expect(await row()).toMatchObject({ status: 'queued', attempt: 1, refundedAttempts: 1, runAfter: later(60 * 60_000) });
  });
});

describe('cancels', () => {
  it('reach the CLI running a job the engine cancelled, and nobody else', async () => {
    const { chat, mayaCli, leoCli, job } = await reviewing();
    await s.dispatcher.dispatch(chat.id, { type: 'pr_closed', merged: false });
    expect((await leoCli.next('job.cancel')).d).toEqual({ ...job, reason: 'pr_closed' });
    await mayaCli.nothing('job.cancel');
  });

  it("stop maya's address job when a human pushes, and hand her the new pass on the new head", async () => {
    const { chat, mayaCli, address } = await addressing();
    await s.dispatcher.dispatch(chat.id, { type: 'head_updated', before: chat.headSha, after: 'd'.repeat(40), ours: false });
    expect((await mayaCli.next('job.cancel')).d).toEqual({ ...address, reason: 'branch_moved' });
    expect((await mayaCli.next('job.assign')).d.bundle).toMatchObject({ type: 'address', pr: { headSha: 'd'.repeat(40) } });
  });
});

describe('drafts and publish jobs (spec §9 "Drafts", §11 "Publish jobs")', () => {
  const draftSha = 'd'.repeat(40);

  /**
   * maya has Auto-fix off. leo's review raised P1, maya's agent fixed it, and its commit waits on her laptop as a
   * draft. She pressed Send, and the publish job went to that laptop.
   */
  async function sending() {
    const maya = await makeUser({ login: 'maya' });
    const leo = await makeUser({ login: 'leo' });
    const repo = await makeRepo();
    const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
    const mayaCli = await TestCli.online(s.url, (await makeCliToken(maya.id)).raw, { repos: [repo.fullName] });
    const leoCli = await TestCli.online(s.url, (await makeCliToken(leo.id)).raw, { repos: [repo.fullName] });
    const mayaP = { ...personOf(maya), autoDefaults: { review: true, address: false } };
    await s.dispatcher.dispatch(chat.id, { type: 'pr_opened', author: mayaP, reviewers: [personOf(leo)] });
    const review = (await leoCli.next('job.assign')).d.bundle;
    leoCli.send(complete({ jobId: review.jobId, attempt: review.attempt }, samples.jobResult()));
    await leoCli.next('ack');

    const address = (await mayaCli.next('job.assign')).d.bundle;
    expect(address).toMatchObject({ type: 'address', apply: 'draft' });
    const draft = { sha: draftSha, from: chat.headSha, files: [{ path: 'src/orders.ts', adds: 3, dels: 1 }], diff: 'diff --git a/src/orders.ts b/src/orders.ts\n' };
    const fixes: JobResult = { ...samples.jobResult(), points: [], replies: [{ point: 1, resolution: 'fixed', comment: 'Added the empty check.' }], draft };
    mayaCli.send(complete({ jobId: address.jobId, attempt: address.attempt }, fixes, 'c2'));
    expect((await mayaCli.next('ack')).d).toEqual({ status: 'applied' });

    await s.dispatcher.dispatch(chat.id, { type: 'draft_send', who: mayaP, jobId: address.jobId });
    const bundle = (await mayaCli.next('job.assign')).d.bundle;
    const publish: RunningJob = { jobId: bundle.jobId, attempt: bundle.attempt };
    const draftRow = () => prisma.job.findUniqueOrThrow({ where: { id: address.jobId } });
    return { chat, mayaCli, leoCli, draft, address, bundle, publish, draftRow };
  }

  it('keeps the draft commit a CLI reports with a draft-mode result, as it sent it', async () => {
    const { draft, draftRow } = await sending();
    expect(await draftRow()).toMatchObject({ status: 'done', applyState: 'draft', result: expect.objectContaining({ draft }) });
  });

  it("applies the drafted replies with the pushed commit once the publish job reports its push, and starts leo's re-review", async () => {
    const { chat, mayaCli, leoCli, address, bundle, publish, draftRow } = await sending();
    expect(bundle).toMatchObject({ type: 'publish', draft: { jobId: address.jobId, sha: draftSha, from: chat.headSha } });
    mayaCli.send({ v: 1, t: 'job.pushing', id: 'p1', d: { ...publish, from: chat.headSha, to: draftSha } });
    expect((await mayaCli.next('ack')).d).toEqual({ status: 'applied' });
    const pushed: JobResult = { summary: '', points: [], decisions: [], replies: [], push: { from: chat.headSha, to: draftSha }, draft: null };
    mayaCli.send(complete(publish, pushed, 'c3'));
    expect((await mayaCli.next('ack')).d).toEqual({ status: 'applied' });

    expect(await draftRow()).toMatchObject({ applyState: 'applied' });
    expect(await prisma.point.findFirstOrThrow({ where: { chatId: chat.id, number: 1 } })).toMatchObject({ status: 'addressed', authorResolution: 'fixed' });
    expect((await prisma.prChat.findUniqueOrThrow({ where: { id: chat.id } })).headSha).toBe(draftSha);
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, role: 'author' } })).toMatchObject({ attention: 'none' });
    expect((await leoCli.next('job.assign')).d.bundle).toMatchObject({ type: 're_review', sinceSha: chat.headSha, pr: { headSha: draftSha } });
  });

  it('marks the draft out of date when the branch moved, and carries on with a new draft for maya', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { chat, mayaCli, publish, draftRow } = await sending();
    mayaCli.send({ v: 1, t: 'job.fail', id: 'f1', d: { ...publish, reason: 'branch_moved', retryable: false, detail: 'non-fast-forward' } });
    expect((await mayaCli.next('ack')).d).toEqual({ status: 'applied' });

    expect(await prisma.job.findUniqueOrThrow({ where: { id: publish.jobId } })).toMatchObject({ status: 'failed', failure: 'branch_moved' });
    expect(await draftRow()).toMatchObject({ applyState: 'discarded' });
    expect(await prisma.message.findFirst({ where: { chatId: chat.id, body: 'The drafted fixes are out of date: the branch moved' } })).not.toBeNull();
    // Auto-fix is still off: the next address pass runs, and its result waits as a draft again.
    expect((await mayaCli.next('job.assign')).d.bundle).toMatchObject({ type: 'address', apply: 'draft' });
  });
});
