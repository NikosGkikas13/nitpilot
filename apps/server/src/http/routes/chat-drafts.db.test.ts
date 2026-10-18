import type { JobResult } from '@nitpilot/protocol';
import * as samples from '@nitpilot/protocol/test-samples';
import { describe, expect, it } from 'vitest';
import { testApp } from '../../../test/app';
import { makeChat, makeGithubSignIn, makeRepo, makeUser, personOf } from '../../../test/db';
import { fakeFetch, json } from '../../../test/fake-fetch';
import { sessionCookieFor } from '../../../test/http';
import { Dispatcher } from '../../chats/dispatch';
import { prisma } from '../../lib/prisma';
import { GithubClient } from '../../platform/github/client';

const ORIGIN = 'http://localhost:8787';

/**
 * maya's PR, reviewed by leo. Both have Auto off for new chats (Settings), so their agents' work waits as drafts.
 * sam can read the repo but isn't in the chat; zoe can't read it. Everyone is signed in to Nitpilot in a browser.
 */
async function scene() {
  const repo = await makeRepo();
  const [maya, leo, sam, zoe] = await Promise.all(['maya', 'leo', 'sam', 'zoe'].map((login) => makeUser({ login })));
  for (const u of [maya, leo, sam, zoe]) await makeGithubSignIn(u!.id);
  await prisma.user.updateMany({ where: { id: { in: [maya!.id, leo!.id] } }, data: { autoReview: false, autoAddress: false } });
  const chat = await makeChat(repo.id, { authorGithubId: maya!.githubId });
  const off = { review: false, address: false };
  const mayaP = { ...personOf(maya!), autoDefaults: off };
  const leoP = { ...personOf(leo!), autoDefaults: off };
  const dispatcher = new Dispatcher();
  await dispatcher.dispatch(chat.id, { type: 'pr_opened', author: mayaP, reviewers: [leoP] });
  // GitHub shows the repo to everyone but zoe (tokens are `ghu_<user id>`, test/db.ts).
  const github = new GithubClient(
    fakeFetch({ [`GET /repos/${repo.fullName}`]: ({ headers }) => (headers.get('authorization')?.includes(zoe!.id) ? json({ message: 'Not Found' }, 404) : { id: 1 }) }),
  );
  const app = testApp({ github, dispatch: dispatcher.dispatch });
  const cookies = new Map(await Promise.all([maya, leo, sam, zoe].map(async (u) => [u!.login, await sessionCookieFor(u!.id)] as const)));
  const call = (method: 'POST' | 'PUT', login: string, path: string, body?: unknown, origin = ORIGIN) =>
    app.request(path, {
      method,
      headers: { cookie: cookies.get(login)!, origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const send = (login: string, jobId: string, origin?: string) => call('POST', login, `/api/chats/${chat.id}/drafts/${jobId}/send`, undefined, origin);
  const discard = (login: string, jobId: string) => call('POST', login, `/api/chats/${chat.id}/drafts/${jobId}/discard`);
  const auto = (login: string, body: unknown, origin?: string) => call('PUT', login, `/api/chats/${chat.id}/auto`, body, origin);

  /** Run the chat's queued job of this type and report `result` for it, as its CLI would. */
  const finish = async (type: string, result: JobResult) => {
    const job = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id, type, status: 'queued' } });
    await prisma.job.update({ where: { id: job.id }, data: { status: 'running', attempt: 1 } });
    await dispatcher.dispatch(chat.id, { type: 'job_completed', jobId: job.id, attempt: 1, result });
    return job;
  };
  return { chat, dispatcher, send, discard, auto, finish, users: { maya: maya!, leo: leo!, sam: sam!, zoe: zoe! } };
}

/** leo's agent reviewed with Auto-review off: its point waits as his draft. */
async function reviewDraft() {
  const s = await scene();
  const review = await s.finish('review', samples.jobResult());
  return { ...s, review };
}

/** leo sent his drafted review; maya's agent fixed P1 with Auto-fix off, and the commit waits as her draft. */
async function fixesDraft() {
  const s = await reviewDraft();
  expect((await s.send('leo', s.review.id)).status).toBe(200);
  const fixes: JobResult = { ...samples.jobResult(), points: [], replies: [{ point: 1, resolution: 'fixed', comment: 'Added the empty check.' }], draft: { sha: 'd'.repeat(40), from: s.chat.headSha, files: [], diff: null } };
  const address = await s.finish('address', fixes);
  return { ...s, address };
}

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;
const job = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });
const publishJobs = (draftOfId: string) => prisma.job.findMany({ where: { draftOfId } });

describe('POST /api/chats/:id/drafts/:jobId/send', () => {
  it("sends leo's drafted review: its point enters the chat, and maya's agent is asked to fix it", async () => {
    const { chat, send, review, users } = await reviewDraft();
    expect(await prisma.point.count({ where: { chatId: chat.id } })).toBe(0);
    const res = await send('leo', review.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await job(review.id)).toMatchObject({ applyState: 'applied' });
    expect(await prisma.point.count({ where: { chatId: chat.id } })).toBe(1);
    // maya has Auto-fix off too: her agent runs, and its fixes will wait as a draft.
    expect(await prisma.job.findFirst({ where: { chatId: chat.id, status: 'queued' } })).toMatchObject({ type: 'address', userId: users.maya.id, applyState: 'draft' });
  });

  it("sends maya's drafted fixes as a publish job; a second press is a 409 that says so (Review Focus 3)", async () => {
    const { send, address } = await fixesDraft();
    const answers = await Promise.all([send('maya', address.id), send('maya', address.id)]);
    expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await errorOf(answers.find((r) => r.status === 409)!)).toEqual({ code: 'conflict', message: 'That draft is already being sent.' });
    expect(await publishJobs(address.id)).toEqual([expect.objectContaining({ type: 'publish', status: 'queued' })]);
    // The draft still waits until the publish job reports its push.
    expect(await job(address.id)).toMatchObject({ applyState: 'draft' });
  });

  it("applies maya's drafted replies at once when her agent changed no file: no commit, so no publish job", async () => {
    const { chat, send, review, finish, users } = await reviewDraft();
    expect((await send('leo', review.id)).status).toBe(200);
    const answered: JobResult = { ...samples.jobResult(), points: [], replies: [{ point: 1, resolution: 'answered', comment: 'It is guarded upstream.' }], push: null, draft: null };
    const address = await finish('address', answered);

    const res = await send('maya', address.id);
    expect(res.status).toBe(200);
    expect(await publishJobs(address.id)).toEqual([]);
    expect(await job(address.id)).toMatchObject({ applyState: 'applied' });
    expect(await prisma.point.findFirstOrThrow({ where: { chatId: chat.id, number: 1 } })).toMatchObject({ status: 'addressed', authorResolution: 'answered' });
    expect(await prisma.job.findFirst({ where: { chatId: chat.id, status: 'queued' } })).toMatchObject({ type: 're_review', userId: users.leo.id });
    const again = await send('maya', address.id);
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toEqual({ code: 'conflict', message: 'That draft was already sent.' });
  });

  it('answers 409 to Send on a draft that was already sent, or discarded', async () => {
    const { send, discard, review, address } = await fixesDraft();
    const again = await send('leo', review.id);
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toEqual({ code: 'conflict', message: 'That draft was already sent.' });

    expect((await discard('maya', address.id)).status).toBe(200);
    const late = await send('maya', address.id);
    expect(late.status).toBe(409);
    expect(await errorOf(late)).toEqual({ code: 'conflict', message: 'That draft was already discarded.' });
    expect(await publishJobs(address.id)).toEqual([]);
  });

  it('answers 409 to Send on a draft that went out of date while it was being sent', async () => {
    const { chat, dispatcher, send, address } = await fixesDraft();
    expect((await send('maya', address.id)).status).toBe(200);
    const [publish] = await publishJobs(address.id);
    await prisma.job.update({ where: { id: publish!.id }, data: { status: 'running', attempt: 1 } });
    await dispatcher.dispatch(chat.id, { type: 'job_failed', jobId: publish!.id, attempt: 1, reason: 'branch_moved', retryable: false });
    const res = await send('maya', address.id);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: 'conflict', message: 'That draft is out of date: the branch moved.' });
  });

  it('keeps the draft waiting when its publish job fails for good on a retryable setup_failed, and calls it discarded, not out of date, once maya discards it', async () => {
    const { chat, dispatcher, send, discard, address } = await fixesDraft();
    expect((await send('maya', address.id)).status).toBe(200);
    const [publish] = await publishJobs(address.id);
    // The third counted attempt: the server couldn't build the bundle, which might have worked next time.
    await prisma.job.update({ where: { id: publish!.id }, data: { status: 'running', attempt: 3 } });
    await dispatcher.dispatch(chat.id, { type: 'job_failed', jobId: publish!.id, attempt: 3, reason: 'setup_failed', retryable: true });
    expect(await job(publish!.id)).toMatchObject({ status: 'failed', failure: 'setup_failed' });
    expect(await job(address.id)).toMatchObject({ applyState: 'draft' });

    expect((await discard('maya', address.id)).status).toBe(200);
    const res = await send('maya', address.id);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: 'conflict', message: 'That draft was already discarded.' });
  });

  it("refuses someone else's draft (403), and hides the chat from someone who can't read the repo (404)", async () => {
    const { send, review } = await reviewDraft();
    for (const login of ['maya', 'sam']) {
      const res = await send(login, review.id);
      expect(res.status).toBe(403);
      expect(await errorOf(res)).toEqual({ code: 'forbidden', message: 'Only the person whose agent made a draft can send or discard it.' });
    }
    expect(await job(review.id)).toMatchObject({ applyState: 'draft' });
    const outsider = await send('zoe', review.id);
    expect(outsider.status).toBe(404);
    expect((await errorOf(outsider)).code).toBe('not_found');
  });

  it("is a 404 for a job that isn't a finished job of this chat", async () => {
    const { send, chat, review } = await reviewDraft();
    // leo sends his draft, so maya's address job is queued: a job that hasn't finished is no draft (yet).
    expect((await send('leo', review.id)).status).toBe(200);
    const queued = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id, status: 'queued' } });
    for (const id of ['no-such-job', queued.id]) {
      const res = await send('maya', id);
      expect(res.status).toBe(404);
      expect(await errorOf(res)).toEqual({ code: 'not_found', message: 'No such draft.' });
    }
  });

  it('refuses a request from another site (the Origin check)', async () => {
    const { send, review } = await reviewDraft();
    const res = await send('leo', review.id, 'https://evil.example');
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toEqual({ code: 'forbidden', message: 'Request did not come from Nitpilot.' });
  });

  it('answers 409 on a closed PR: its chat is read-only', async () => {
    const { chat, dispatcher, send, review } = await reviewDraft();
    await dispatcher.dispatch(chat.id, { type: 'pr_closed', merged: false });
    const res = await send('leo', review.id);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: 'conflict', message: 'This PR is closed, so its chat is read-only.' });
  });
});

describe('POST /api/chats/:id/drafts/:jobId/discard', () => {
  it("discards leo's drafted review: it counts as reviewed, and nothing is raised", async () => {
    const { chat, discard, review } = await reviewDraft();
    const res = await discard('leo', review.id);
    expect(res.status).toBe(200);
    expect(await job(review.id)).toMatchObject({ applyState: 'discarded' });
    expect(await prisma.point.count({ where: { chatId: chat.id } })).toBe(0);
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, role: 'reviewer' } })).toMatchObject({ attention: 'none', lastReviewedSha: chat.headSha });
  });

  it("discards maya's drafted fixes while the publish job waits: the job is cancelled, and P1 is hers to fix by hand", async () => {
    const { chat, send, discard, address } = await fixesDraft();
    expect((await send('maya', address.id)).status).toBe(200);
    expect((await discard('maya', address.id)).status).toBe(200);
    expect(await publishJobs(address.id)).toEqual([expect.objectContaining({ status: 'cancelled', cancelReason: 'draft_discarded' })]);
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, role: 'author' } })).toMatchObject({ attention: 'none', byHand: true });
    // Auto off plus Discard never loops: no new address job.
    expect(await prisma.job.count({ where: { chatId: chat.id, status: { in: ['queued', 'running'] } } })).toBe(0);
  });

  it('answers 409 once the publish job runs: its push may be under way, so its result decides', async () => {
    const { send, discard, address } = await fixesDraft();
    expect((await send('maya', address.id)).status).toBe(200);
    await prisma.job.updateMany({ where: { draftOfId: address.id }, data: { status: 'running', attempt: 1 } });
    const res = await discard('maya', address.id);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: 'conflict', message: "That draft is being sent right now, so it can't be discarded." });
    expect(await job(address.id)).toMatchObject({ applyState: 'draft' });
  });

  it("refuses someone else's draft (403), and answers 409 to a second Discard", async () => {
    const { discard, review } = await reviewDraft();
    expect((await discard('maya', review.id)).status).toBe(403);
    expect((await discard('leo', review.id)).status).toBe(200);
    const again = await discard('leo', review.id);
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toEqual({ code: 'conflict', message: 'That draft was already discarded.' });
  });
});

describe('PUT /api/chats/:id/auto', () => {
  it("turns leo's Auto-review on in this chat, says so in the timeline, and answers 409 when it's already on", async () => {
    const { chat, auto } = await scene();
    const res = await auto('leo', { role: 'reviewer', on: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, role: 'reviewer' } })).toMatchObject({ auto: true });
    // His queued review follows the switch: its result will be applied, not drafted.
    expect(await prisma.job.findFirstOrThrow({ where: { chatId: chat.id, type: 'review' } })).toMatchObject({ applyState: 'pending' });
    expect(await prisma.message.findFirst({ where: { chatId: chat.id }, orderBy: { seq: 'desc' } })).toMatchObject({ kind: 'system', body: 'leo turned Auto-review on' });

    const again = await auto('leo', { role: 'reviewer', on: true });
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toEqual({ code: 'conflict', message: 'Auto-review is already on.' });
  });

  it("refuses a switch for a role you don't have (403)", async () => {
    const { auto } = await scene();
    const leo = await auto('leo', { role: 'author', on: true });
    expect(leo.status).toBe(403);
    expect(await errorOf(leo)).toEqual({ code: 'forbidden', message: "You aren't the author of this PR, so there's no Auto-fix of yours to switch." });
    const sam = await auto('sam', { role: 'reviewer', on: true });
    expect(sam.status).toBe(403);
    expect((await errorOf(sam)).message).toBe("You aren't a reviewer of this PR, so there's no Auto-review of yours to switch.");
  });

  it('refuses another Origin (403), a body that is not a switch (400), and a closed PR (409)', async () => {
    const { chat, dispatcher, auto } = await scene();
    expect((await auto('maya', { role: 'author', on: true }, 'https://evil.example')).status).toBe(403);
    expect((await auto('maya', { role: 'author' })).status).toBe(400);
    await dispatcher.dispatch(chat.id, { type: 'pr_closed', merged: true });
    const closed = await auto('maya', { role: 'author', on: true });
    expect(closed.status).toBe(409);
    expect((await errorOf(closed)).message).toBe('This PR is closed, so its chat is read-only.');
  });
});
