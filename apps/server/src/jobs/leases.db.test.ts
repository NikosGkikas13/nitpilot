import { LEASE_SEC } from '@nitpilot/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChat, makeCliToken, makeRepo, makeUser, personOf, resetDb } from '../../test/db';
import { ping, startCliServer, TestCli, type CliServer } from '../../test/ws';
import type { Dispatch } from '../chats/dispatch';
import { prisma } from '../lib/prisma';
import { currentAttempt, Leases } from './leases';

// The sweep looks at every running job, so each test starts from an empty database.
// The leases run on `clock`, but the hub notes a CLI's last message in real time. So moving `clock`
// past 60 s also makes every CLI look silent to the sweep; a test that keeps talking to its CLI
// after a sweep runs out the lease in the database instead (`expireLease`).
let s: CliServer;
let clock: Date;
const later = (ms: number) => new Date(clock.getTime() + ms);
const expireLease = (jobId: string) => prisma.job.update({ where: { id: jobId }, data: { leaseExpiresAt: later(-1) } });

beforeEach(async () => {
  await resetDb();
  clock = new Date();
  s = await startCliServer({ now: () => clock });
});
afterEach(() => s.close());

/** leo's review job, handed to leo's laptop. */
async function assigned() {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const repo = await makeRepo();
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  const laptopToken = await makeCliToken(leo.id);
  const laptop = await TestCli.online(s.url, laptopToken.raw, { device: 'laptop', repos: [repo.fullName] });
  await s.dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
  const { bundle } = (await laptop.next('job.assign')).d;
  const job = { jobId: bundle.jobId, attempt: bundle.attempt };
  const row = () => prisma.job.findUniqueOrThrow({ where: { id: job.jobId } });
  return { leo, repo, chat, laptopToken, laptop, job, row };
}

describe('pings', () => {
  it('renew the lease of each job the CLI lists', async () => {
    const { laptop, job, row } = await assigned();
    clock = later(60_000);
    laptop.send(ping([job]));
    await laptop.next('pong');
    expect((await row()).leaseExpiresAt).toEqual(later(LEASE_SEC * 1000));
  });

  it('put a job back in the queue when two pings in a row leave it out, and tell the CLI to stop', async () => {
    const { laptop, job, row } = await assigned();
    laptop.send(ping([]));
    await laptop.next('pong');
    expect((await row()).status).toBe('running'); // once is forgiven: the ping may have crossed job.assign
    laptop.send(ping([]));
    await laptop.next('pong');
    expect(await row()).toMatchObject({ status: 'queued', attempt: 1, cliTokenId: null, runAfter: later(30_000) });
    expect((await laptop.next('job.cancel')).d).toEqual({ ...job, reason: 'missed_pings' });
  });
});

describe('missed pings', () => {
  it('are forgiven once again when the job comes back on a new attempt', async () => {
    const { chat, laptop, job, row } = await assigned();
    laptop.send(ping([]));
    await laptop.next('pong'); // J#1 missed once: the ping may have crossed its job.assign
    // J#1 fails and is requeued (30 s delay, skipped here); the laptop gets it again as attempt 2.
    await s.dispatcher.dispatch(chat.id, { type: 'job_failed', jobId: job.jobId, attempt: job.attempt, reason: 'crash', retryable: true });
    await prisma.job.update({ where: { id: job.jobId }, data: { runAfter: clock } });
    await s.assigner.tick();
    expect((await laptop.next('job.assign')).d.bundle.attempt).toBe(2);
    // A ping that crossed this new hand-out is a first miss for attempt 2, not a second one.
    laptop.send(ping([]));
    await laptop.next('pong');
    await laptop.nothing('job.cancel');
    expect(await row()).toMatchObject({ status: 'running', attempt: 2 });
  });

  it('are forgotten for jobs the CLI no longer holds', async () => {
    const { chat, laptop, laptopToken, job } = await assigned();
    laptop.send(ping([]));
    await laptop.next('pong');
    const conn = s.hub.connection(laptopToken.id)!;
    expect(conn.missedPings.size).toBe(1);
    // The job leaves this CLI (failed, waiting for its retry), and the next ping has nothing bound to count.
    await s.dispatcher.dispatch(chat.id, { type: 'job_failed', jobId: job.jobId, attempt: job.attempt, reason: 'crash', retryable: true });
    laptop.send(ping([]));
    await laptop.next('pong');
    expect(conn.missedPings.size).toBe(0);
  });

  it('still answer the ping when taking back one job fails', async () => {
    const maya = await makeUser({ login: 'maya' });
    const leo = await makeUser({ login: 'leo' });
    const repo = await makeRepo();
    const laptopToken = await makeCliToken(leo.id);
    const laptop = await TestCli.online(s.url, laptopToken.raw, { device: 'laptop', repos: [repo.fullName], concurrency: 2 });
    for (const number of [1, 2]) {
      const chat = await makeChat(repo.id, { number, authorGithubId: maya.githubId });
      await s.dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
    }
    const first = (await laptop.next('job.assign')).d.bundle;
    const second = (await laptop.next('job.assign')).d.bundle;
    const rowOf = (jobId: string) => prisma.job.findUniqueOrThrow({ where: { id: jobId } });

    // A second Leases whose database trouble hits one job only. It shares the connection (and its counts) with the wired one.
    let triedToFail = 0;
    const flaky: Dispatch = async (chatId, event, opts) => {
      if (event.type === 'job_failed' && event.jobId === first.jobId) {
        triedToFail += 1;
        throw new Error('the database is having a moment');
      }
      return s.dispatcher.dispatch(chatId, event, opts);
    };
    const leases = new Leases(s.hub, flaky, () => clock);
    const conn = s.hub.connection(laptopToken.id)!;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await leases.handle(conn, ping([])); // both jobs missed once: forgiven
      await laptop.next('pong');
      await leases.handle(conn, ping([])); // both missed twice: both are taken back, and the first can't be
      await laptop.next('pong');
      expect(errors).toHaveBeenCalledWith(expect.stringContaining(`could not take back job ${first.jobId}`), expect.any(Error));
      expect(await rowOf(second.jobId)).toMatchObject({ status: 'queued', cliTokenId: null });
      expect(await rowOf(first.jobId)).toMatchObject({ status: 'running', cliTokenId: laptopToken.id });
      expect(triedToFail).toBe(1);
      // Its count was kept, so the next ping tries again.
      await leases.handle(conn, ping([]));
      await laptop.next('pong');
      expect(triedToFail).toBe(2);
    } finally {
      errors.mockRestore();
    }
  });
});

describe('expired leases', () => {
  it('go back to the queue through the engine; the CLI is told to stop, and again if it still lists the job', async () => {
    const { laptop, job, row } = await assigned();
    await expireLease(job.jobId);
    await s.leases.sweep();
    expect(await row()).toMatchObject({ status: 'queued', cliTokenId: null });
    expect((await laptop.next('job.cancel')).d).toEqual({ ...job, reason: 'lease_expired' });
    // Say the laptop was asleep and missed that cancel: its next ping still lists the job.
    laptop.send(ping([job]));
    await laptop.next('pong');
    expect((await laptop.next('job.cancel')).d).toEqual({ ...job, reason: 'stale' });
    expect((await row()).status).toBe('queued');
  });

  it('count as attempts: the third one fails the job and tells its owner', async () => {
    const { chat, job, row } = await assigned();
    await prisma.job.update({ where: { id: job.jobId }, data: { attempt: 3 } });
    await expireLease(job.jobId);
    await s.leases.sweep();
    expect(await row()).toMatchObject({ status: 'failed', failure: 'timeout' });
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, role: 'reviewer' } })).toMatchObject({ attention: 'failed' });
    expect(await prisma.task.count({ where: { chatId: chat.id, kind: 'notify' } })).toBe(1);
  });

  it('are renewed when the server restarts: it was the server that was away', async () => {
    const { row } = await assigned();
    clock = later(10 * 60_000); // the server was down for ten minutes
    expect(await s.leases.renewAfterRestart()).toBe(1);
    await s.leases.sweep();
    expect(await row()).toMatchObject({ status: 'running', leaseExpiresAt: later(LEASE_SEC * 1000) });
  });
});

describe('reconnecting', () => {
  it('lets a laptop that slept keep its job while the lease is valid', async () => {
    const { repo, laptop, laptopToken, job, row } = await assigned();
    laptop.close();
    await laptop.closed;
    clock = later(60_000); // asleep for a minute: the 90-second lease still holds
    const woken = await TestCli.online(s.url, laptopToken.raw, { device: 'laptop', repos: [repo.fullName], running: [job] });
    await s.settle();
    await woken.nothing('job.cancel');
    expect(await row()).toMatchObject({ status: 'running', attempt: 1, cliTokenId: laptopToken.id, leaseExpiresAt: later(LEASE_SEC * 1000) });
  });

  it('tells a laptop that woke too late to stop: its job went to another CLI', async () => {
    const { leo, repo, laptop, laptopToken, job, row } = await assigned();
    laptop.close();
    await laptop.closed;
    clock = later(LEASE_SEC * 1000 + 1);
    await s.leases.sweep(); // the lease ran out: back to the queue
    await prisma.job.update({ where: { id: job.jobId }, data: { runAfter: clock } }); // skip the retry delay
    const desktopToken = await makeCliToken(leo.id);
    const desktop = await TestCli.online(s.url, desktopToken.raw, { device: 'desktop', repos: [repo.fullName] });
    expect((await desktop.next('job.assign')).d.bundle.attempt).toBe(2);

    const woken = await TestCli.online(s.url, laptopToken.raw, { device: 'laptop', repos: [repo.fullName], running: [job] });
    expect((await woken.next('job.cancel')).d).toEqual({ ...job, reason: 'stale' });
    await desktop.nothing('job.cancel');
    expect(await row()).toMatchObject({ status: 'running', attempt: 2, cliTokenId: desktopToken.id });
  });
});

describe('fencing and liveness', () => {
  it('currentAttempt knows which attempt is current, and on which CLI', async () => {
    const { leo, chat, laptopToken, job } = await assigned();
    const otherDevice = await makeCliToken(leo.id);
    expect(await currentAttempt(laptopToken.id, job)).toEqual({ chatId: chat.id });
    expect(await currentAttempt(laptopToken.id, { ...job, attempt: job.attempt + 1 })).toBeNull();
    expect(await currentAttempt(otherDevice.id, job)).toBeNull();
  });

  it("never hands out the same attempt number twice, even when a failure doesn't count", async () => {
    const { chat, laptop, laptopToken, job, row } = await assigned();
    // branch_moved is not the agent's fault: the job is queued again at once and the attempt is refunded.
    await s.dispatcher.dispatch(chat.id, { type: 'job_failed', jobId: job.jobId, attempt: job.attempt, reason: 'branch_moved', retryable: true });
    expect((await laptop.next('job.assign')).d.bundle.attempt).toBe(2);
    expect(await row()).toMatchObject({ status: 'running', attempt: 2, refundedAttempts: 1 });
    // So a message about the first run can never be taken for one about the second.
    expect(await currentAttempt(laptopToken.id, job)).toBeNull();
    expect(await currentAttempt(laptopToken.id, { jobId: job.jobId, attempt: 2 })).toEqual({ chatId: chat.id });
  });

  it('drops a CLI that went silent', async () => {
    const leo = await makeUser({ login: 'leo' });
    const cli = await TestCli.online(s.url, (await makeCliToken(leo.id)).raw);
    expect(s.hub.dropSilent(new Date(Date.now() - 60_000))).toBe(0); // it just said hello
    expect(s.hub.dropSilent(new Date(Date.now() + 1_000))).toBe(1);
    expect((await cli.closed).code).toBe(1006);
    expect(s.hub.connections()).toEqual([]);
  });
});
