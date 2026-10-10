import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JobBundle, RunningJob, ServerToCli } from '@nitpilot/protocol';
import { jobBundle, jobResult } from '@nitpilot/protocol/test-samples';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { recordOut } from '../test/out';
import { startStubHub, type StubConnection } from '../test/stub-hub';
import type { StubRoutes } from '../test/stub-server';
import { tempDir } from '../test/temp';
import { PersonalConfigSchema } from './config/config';
import { Backoff } from './connection/backoff';
import { startDaemon, type DaemonOptions, type JobExecutor, type JobOutcome } from './daemon';
import { localDay } from './state';
import { CLI_VERSION } from './version';

const TOKEN = 'nit_test';
const JOB: RunningJob = { jobId: 'job_1', attempt: 1 }; // the sample bundle's
const done: JobOutcome = { kind: 'complete', result: jobResult() };
const assign = (bundle: JobBundle = jobBundle()): ServerToCli => ({ v: 1, t: 'job.assign', d: { bundle } });

/** A promise the test settles by hand, e.g. an executor that finishes when told to. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A stub server, and a daemon talking to it with fast timings. Both stop when the test ends. */
async function setup(over: Partial<DaemonOptions> = {}, opts: { daemonToken?: string; routes?: StubRoutes; serverSuffix?: string } = {}) {
  const hub = await startStubHub({ token: TOKEN, routes: opts.routes });
  const out = recordOut();
  const notified: string[] = [];
  const daemon = startDaemon({
    config: PersonalConfigSchema.parse({ server: `${hub.url}${opts.serverSuffix ?? ''}`, token: opts.daemonToken ?? TOKEN, repos: { 'acme/shop-api': { path: '/code/shop-api' } } }),
    configDir: tempDir(),
    agent: { id: 'fake', version: null, modes: ['reviewer', 'editor'] },
    executor: async () => done,
    out,
    notify: async (message) => void notified.push(message),
    device: 'test laptop',
    backoff: new Backoff({ startMs: 20, maxMs: 100 }),
    pingEveryMs: 50,
    silentMs: 10_000,
    ...over,
  });
  onTestFinished(async () => {
    daemon.stop();
    await daemon.stopped;
    await hub.close();
  });
  return { hub, daemon, out, notified };
}

/** The daemon's next connection: wait for its hello and answer welcome. */
async function welcomed(hub: Awaited<ReturnType<typeof startStubHub>>) {
  const conn = await hub.connection();
  const hello = await conn.next('hello');
  conn.welcome();
  return { conn, hello };
}

/** Wait for a ping (one every 50 ms) whose running list is exactly `expected`. */
function pingListing(conn: StubConnection, expected: RunningJob[]) {
  return conn.nextMatching('ping', (ping) => JSON.stringify(ping.d.running) === JSON.stringify(expected));
}

/** Wait until the daemon has handled everything sent so far. It handles messages in order, so once it shows a notification, it has seen what came before. */
async function handled(conn: StubConnection, notified: string[]) {
  const title = `handled ${notified.length}`;
  conn.send({ v: 1, t: 'notify', d: { kind: 'ready', chatId: 'chat_1', title, url: 'http://nitpilot.test/x' } });
  await vi.waitFor(() => expect(notified).toContain(title));
}

/** An executor that records the signal of every run, and finishes (as a failure) only when that signal aborts. */
function abortableExecutor() {
  const signals: AbortSignal[] = [];
  const executor: JobExecutor = (_bundle, io) =>
    new Promise((resolve) => {
      signals.push(io.signal);
      io.signal.addEventListener('abort', () => resolve({ kind: 'fail', reason: 'crash', retryable: true, detail: 'stopped' }));
    });
  return { executor, signals };
}

describe('startDaemon', () => {
  it('says hello with what this device can do', async () => {
    const { hub } = await setup();
    const { hello } = await welcomed(hub);
    expect(hello.d).toEqual({
      protocol: 1,
      cliVersion: CLI_VERSION,
      device: 'test laptop',
      agent: { id: 'fake', version: null, modes: ['reviewer', 'editor'] },
      repos: ['acme/shop-api'],
      concurrency: 1,
      running: [],
      defaults: { autoReview: true, autoAddress: true },
    });
  });

  it('pings on a timer once welcomed', async () => {
    const { hub } = await setup();
    const { conn } = await welcomed(hub);
    expect((await conn.next('ping')).d.running).toEqual([]);
    expect((await conn.next('ping')).d.running).toEqual([]);
  });

  it('runs a job and sends its result; the job counts as running until the server acks it', async () => {
    const finish = deferred<JobOutcome>();
    const executor = vi.fn<JobExecutor>(() => finish.promise);
    const { hub } = await setup({ executor });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    await pingListing(conn, [JOB]);
    expect(executor).toHaveBeenCalledWith(jobBundle(), expect.objectContaining({ signal: expect.any(AbortSignal) }));

    finish.resolve(done);
    const complete = await conn.next('job.complete');
    expect(complete.d).toEqual({ ...JOB, result: jobResult() });
    conn.forget('ping');
    await pingListing(conn, [JOB]); // sent, but not acked yet
    conn.send({ v: 1, t: 'ack', re: complete.id, d: { status: 'applied' } });
    await pingListing(conn, []);
  });

  it("turns down the day's 41st job without running it", async () => {
    const configDir = tempDir();
    writeFileSync(join(configDir, 'state.json'), JSON.stringify({ day: localDay(new Date()), jobs: 40 }));
    const executor = vi.fn<JobExecutor>(async () => done);
    const { hub } = await setup({ executor, configDir });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    expect((await conn.next('job.reject')).d).toEqual({ ...JOB, reason: 'daily_cap' });
    expect(executor).not.toHaveBeenCalled();
  });

  it('stops a job the server cancels, and sends nothing for it', async () => {
    let signal: AbortSignal | undefined;
    const executor: JobExecutor = (_bundle, io) =>
      new Promise((resolve) => {
        signal = io.signal;
        io.signal.addEventListener('abort', () => resolve({ kind: 'fail', reason: 'crash', retryable: true, detail: 'stopped' }));
      });
    const { hub } = await setup({ executor });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    await pingListing(conn, [JOB]);
    conn.send({ v: 1, t: 'job.cancel', d: { ...JOB, reason: 'pr_closed' } });
    conn.forget('ping');
    await pingListing(conn, []);
    expect(signal?.aborted).toBe(true);
    await conn.nothing('job.fail');
  });

  it("ignores a cancel for a job it doesn't know, and leaves the job that is running alone", async () => {
    const { executor, signals } = abortableExecutor();
    const { hub, out, notified } = await setup({ executor });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    await pingListing(conn, [JOB]);
    conn.send({ v: 1, t: 'job.cancel', d: { jobId: 'job_unknown', attempt: 3, reason: 'stale' } });
    await handled(conn, notified);
    conn.forget('ping');
    await pingListing(conn, [JOB]);
    expect(signals[0]?.aborted).toBe(false);
    expect(out.text()).not.toContain('job_unknown');
  });

  it('ignores a cancel for another attempt of the job that is running', async () => {
    const { executor, signals } = abortableExecutor();
    const { hub, out, notified } = await setup({ executor });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    await pingListing(conn, [JOB]);
    conn.send({ v: 1, t: 'job.cancel', d: { jobId: 'job_1', attempt: 2, reason: 'pr_closed' } });
    await handled(conn, notified);
    conn.forget('ping');
    await pingListing(conn, [JOB]);
    expect(signals[0]?.aborted).toBe(false);
    expect(out.text()).not.toContain('Stopped');
  });

  it('runs a job handed out twice once', async () => {
    const executor = vi.fn<JobExecutor>(() => new Promise<JobOutcome>(() => {})); // never finishes
    const { hub, notified } = await setup({ executor });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    conn.send(assign());
    await handled(conn, notified);
    conn.forget('ping');
    await pingListing(conn, [JOB]);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('stops the older run when a newer attempt of the job arrives, and answers only for the newer one', async () => {
    const { executor, signals } = abortableExecutor();
    const { hub } = await setup({ executor });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    await pingListing(conn, [JOB]);
    conn.send(assign({ ...jobBundle(), attempt: 2 }));
    conn.forget('ping');
    await pingListing(conn, [{ jobId: 'job_1', attempt: 2 }]);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    // The stopped run's executor did finish (with a failure), but nothing is sent for it.
    await Promise.all([conn.nothing('job.fail'), conn.nothing('job.complete')]);
  });

  it.each([
    [4401, 'reauth', 'Run `nitpilot login`'],
    [4426, 'upgrade', 'npm install -g nitpilot@latest'],
    [4409, 'replaced', 'Another `nitpilot start` on this device took over'],
  ] as const)('stops for good on %i (%s), saying what to do', async (code, reason, advice) => {
    const { hub, daemon, out } = await setup();
    const { conn } = await welcomed(hub);
    conn.close(code, 'bye');
    expect(await daemon.stopped).toBe(reason);
    expect(out.text()).toContain(advice);
    await hub.noConnection();
  });

  it('reconnects after any other close, and says hello again', async () => {
    const { hub } = await setup();
    const { conn } = await welcomed(hub);
    conn.close(1012, 'server restarting');
    const again = await hub.connection();
    expect((await again.next('hello')).d.device).toBe('test laptop');
  });

  it('lists a job still in progress in its hello after a reconnect (Review Focus #1)', async () => {
    const { hub } = await setup({ executor: () => new Promise<JobOutcome>(() => {}) }); // never finishes
    const { conn } = await welcomed(hub);
    conn.send(assign());
    await pingListing(conn, [JOB]);
    conn.close(1012, 'server restarting');
    const again = await hub.connection();
    expect((await again.next('hello')).d.running).toEqual([JOB]);
  });

  it('sends a result again after reconnecting when it was never acked, and drops it on a stale ack', async () => {
    const { hub, out } = await setup();
    const { conn } = await welcomed(hub);
    conn.send(assign());
    const first = await conn.next('job.complete');
    conn.close(1012, 'server restarting');

    const { conn: again, hello } = await welcomed(hub);
    expect(hello.d.running).toEqual([JOB]); // still running: its result wasn't acked
    const resent = await again.next('job.complete');
    expect(resent).toEqual(first); // the same id, so it's recognizably the same answer
    again.send({ v: 1, t: 'ack', re: resent.id, d: { status: 'stale' } });
    again.forget('ping');
    await pingListing(again, []);
    expect(out.text()).toContain('stale');
  });

  it('sends an answer again on the same connection when no ack came, so a server that failed to handle it does not hold the job', async () => {
    const { hub } = await setup();
    const { conn } = await welcomed(hub);
    conn.send(assign());
    const first = await conn.next('job.complete'); // the stub says nothing back
    const again = await conn.next('job.complete'); // two ping intervals (about 100 ms) later
    expect(again).toEqual(first); // the same id
    conn.send({ v: 1, t: 'ack', re: again.id, d: { status: 'applied' } });
    conn.forget('ping');
    await pingListing(conn, []);
  });

  it('drops a socket that went quiet and connects again, like a laptop back from sleep', async () => {
    const { hub, out } = await setup({ silentMs: 200 });
    const { conn } = await welcomed(hub);
    conn.answerPings = false; // the socket looks open, but nothing comes back
    const again = await hub.connection(3_000);
    await again.next('hello');
    expect(out.text()).toContain('The server went quiet.');
  });

  it("asks whether its token still works when it can't connect, and stops if not", async () => {
    const routes: StubRoutes = { 'GET /api/me': { status: 401, body: { error: { code: 'unauthorized', message: 'Missing or invalid CLI token.' } } } };
    const { daemon, out } = await setup({}, { daemonToken: 'nit_revoked', routes });
    expect(await daemon.stopped).toBe('reauth');
    expect(out.text()).toContain('Run `nitpilot login`');
  });

  it('shows notifications in the terminal and on the desktop', async () => {
    const { hub, out, notified } = await setup();
    const { conn } = await welcomed(hub);
    conn.send({ v: 1, t: 'notify', d: { kind: 'ready', chatId: 'chat_1', title: 'Ready for your approval: acme/shop-api#142', url: 'http://nitpilot.test/c/acme/shop-api/142' } });
    await vi.waitFor(() => expect(notified).toEqual(['Ready for your approval: acme/shop-api#142']));
    expect(out.text()).toContain('Ready for your approval: acme/shop-api#142  http://nitpilot.test/c/acme/shop-api/142');
  });

  it("asks before pushing, and gives the executor the server's answer", async () => {
    const answer = deferred<'applied' | 'stale'>();
    const executor: JobExecutor = async (_bundle, io) => {
      answer.resolve(await io.pushing('a'.repeat(40), 'c'.repeat(40)));
      return done;
    };
    const { hub } = await setup({ executor });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    const pushing = await conn.next('job.pushing');
    expect(pushing.d).toEqual({ ...JOB, from: 'a'.repeat(40), to: 'c'.repeat(40) });
    conn.send({ v: 1, t: 'ack', re: pushing.id, d: { status: 'applied' } });
    expect(await answer.promise).toBe('applied');
  });

  it('reports an executor that throws as a crash, so the server can retry it', async () => {
    const { hub } = await setup({
      executor: async () => {
        throw new Error('boom');
      },
    });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    expect((await conn.next('job.fail')).d).toMatchObject({ ...JOB, reason: 'crash', retryable: true, detail: expect.stringContaining('boom') });
  });

  it("fails a job as a crash, without running it, when the day's count can't be saved", async () => {
    const configDir = join(tempDir(), 'config');
    writeFileSync(configDir, 'a file where the config folder should be'); // state.json can't be written under a file
    const executor = vi.fn<JobExecutor>(async () => done);
    const { hub } = await setup({ executor, configDir });
    const { conn } = await welcomed(hub);
    conn.send(assign());
    const fail = await conn.next('job.fail');
    expect(fail.d).toMatchObject({ ...JOB, reason: 'crash', retryable: true });
    expect(executor).not.toHaveBeenCalled();
    conn.send({ v: 1, t: 'ack', re: fail.id, d: { status: 'applied' } });
    conn.forget('ping');
    await pingListing(conn, []);
  });

  it('connects when the server URL ends with a slash', async () => {
    const { hub } = await setup({}, { serverSuffix: '/' });
    const { hello } = await welcomed(hub);
    expect(hello.d.device).toBe('test laptop');
  });

  it('stops at once when told to while it is checking whether its token works', async () => {
    let checking: AbortSignal | undefined;
    const asked = deferred<void>();
    // A server that never answers: the request ends only when the daemon gives up on it.
    const hangingFetch: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        checking = init?.signal ?? undefined;
        checking?.addEventListener('abort', () => reject(new Error('aborted')));
        asked.resolve();
      });
    const { daemon, out } = await setup({ fetch: hangingFetch, backoff: new Backoff({ startMs: 60_000 }) }, { daemonToken: 'nit_revoked' });
    await asked.promise; // the connection was refused, and the daemon is now asking GET /api/me
    daemon.stop();
    expect(await daemon.stopped).toBe('stopped');
    expect(checking?.aborted).toBe(true);
    expect(out.text()).not.toContain('Trying again');
  }, 3_000);
});
