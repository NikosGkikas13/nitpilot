import { afterEach, describe, expect, it, vi } from 'vitest';
import { testApp } from '../../../test/app';
import { makeChat, makeCliToken, makeGithubSignIn, makeRepo, makeUser, personOf } from '../../../test/db';
import { fakeFetch, json } from '../../../test/fake-fetch';
import { sessionCookieFor } from '../../../test/http';
import { Dispatcher } from '../../chats/dispatch';
import { prisma } from '../../lib/prisma';
import { GithubClient } from '../../platform/github/client';

afterEach(() => vi.restoreAllMocks());

const ORIGIN = 'http://localhost:8787';

/**
 * maya's PR, reviewed by leo (requested) and nina (in the chat, no longer requested). P1 is leo's agent's security
 * point, escalated. sam can read the repo but isn't in the chat; zoe can't read it; kai's GitHub sign-in expired.
 * Everyone is signed in to Nitpilot in a browser.
 */
async function scene(opts: { trusted?: boolean } = {}) {
  const repo = await makeRepo();
  const [maya, leo, nina, sam, zoe, kai] = await Promise.all(['maya', 'leo', 'nina', 'sam', 'zoe', 'kai'].map((login) => makeUser({ login })));
  for (const u of [maya, leo, nina, sam, zoe]) await makeGithubSignIn(u!.id);
  await makeGithubSignIn(kai!.id, 'needs_reauth');
  const chat = await makeChat(repo.id, { authorGithubId: maya!.githubId, trusted: opts.trusted ?? true });
  const dispatcher = new Dispatcher();
  await dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya!), reviewers: [personOf(leo!), personOf(nina!)] });
  await dispatcher.dispatch(chat.id, { type: 'review_request_removed', reviewer: personOf(nina!) });
  // GitHub shows the repo to everyone but zoe (tokens are `ghu_<user id>`, test/db.ts).
  const github = new GithubClient(
    fakeFetch({ [`GET /repos/${repo.fullName}`]: ({ headers }) => (headers.get('authorization')?.includes(zoe!.id) ? json({ message: 'Not Found' }, 404) : { id: 1 }) }),
  );
  const app = testApp({ github, dispatch: dispatcher.dispatch });
  const cookies = new Map(await Promise.all([maya, leo, nina, sam, zoe, kai].map(async (u) => [u!.login, await sessionCookieFor(u!.id)] as const)));
  const post = (login: string, path: string, body?: unknown, origin = ORIGIN) =>
    app.request(path, {
      method: 'POST',
      headers: { cookie: cookies.get(login)!, origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { repo, chat, dispatcher, app, post, users: { maya: maya!, leo: leo!, nina: nina!, sam: sam!, zoe: zoe!, kai: kai! } };
}

/** leo's agent's P1, escalated as a security point; the chat waits for a person. */
async function escalateP1(chatId: string, raisedBy: { githubId: string }, over: { origin?: string } = {}) {
  await prisma.job.updateMany({ where: { chatId }, data: { status: 'done', activeFor: null } });
  await prisma.point.create({
    data: {
      chatId, number: 1, raisedByGithubId: raisedBy.githubId, origin: over.origin ?? 'agent', severity: 'blocker', category: 'security',
      title: 'SQL built from input', body: 'Use a parameter.', status: 'escalated', escalationReason: 'category', round: 1,
    },
  });
  await prisma.prChat.update({ where: { id: chatId }, data: { phase: 'escalated' } });
  await prisma.participant.updateMany({ where: { chatId, role: 'author' }, data: { lastReviewedSha: null } });
  await prisma.participant.updateMany({ where: { chatId, role: 'reviewer' }, data: { lastReviewedSha: 'a'.repeat(40) } });
}

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;
const lastItem = (chatId: string) => prisma.message.findFirstOrThrow({ where: { chatId }, orderBy: { seq: 'desc' } });

describe('POST /api/chats/:id/notes', () => {
  it('adds a note from the author or a reviewer to the timeline', async () => {
    const { chat, post } = await scene();
    for (const login of ['maya', 'leo', 'nina']) {
      const res = await post(login, `/api/chats/${chat.id}/notes`, { body: `  Keep the old endpoint, ${login}  ` });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(await lastItem(chat.id)).toMatchObject({ kind: 'human', authorLogin: login, body: `Keep the old endpoint, ${login}` });
    }
  });

  it('refuses someone who only reads along (403), and hides the chat from someone who cannot read the repo (404)', async () => {
    const { chat, post } = await scene();
    const reader = await post('sam', `/api/chats/${chat.id}/notes`, { body: 'Hello' });
    expect(reader.status).toBe(403);
    expect(await errorOf(reader)).toEqual({ code: 'forbidden', message: 'Only the author and the reviewers can message the agents.' });
    const outsider = await post('zoe', `/api/chats/${chat.id}/notes`, { body: 'Hello' });
    expect(outsider.status).toBe(404);
    expect(await errorOf(outsider)).toEqual(await errorOf(await post('zoe', '/api/chats/no-such-chat/notes', { body: 'Hello' })));
  });

  it('asks someone whose GitHub sign-in expired to sign in again, whether or not the chat exists', async () => {
    const { chat, post } = await scene();
    for (const id of [chat.id, 'no-such-chat']) {
      const res = await post('kai', `/api/chats/${id}/notes`, { body: 'Hello' });
      expect(res.status).toBe(401);
      expect((await errorOf(res)).code).toBe('reauth');
    }
  });

  it('takes 1 to 4,000 characters', async () => {
    const { chat, post } = await scene();
    expect((await post('maya', `/api/chats/${chat.id}/notes`, { body: 'x'.repeat(4000) })).status).toBe(200);
    expect((await post('maya', `/api/chats/${chat.id}/notes`, { body: 'x'.repeat(4001) })).status).toBe(400);
    expect((await post('maya', `/api/chats/${chat.id}/notes`, { body: '   ' })).status).toBe(400);
  });

  it('refuses a request from another site (the Origin check)', async () => {
    const { chat, post } = await scene();
    const res = await post('maya', `/api/chats/${chat.id}/notes`, { body: 'Hello' }, 'https://evil.example');
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toEqual({ code: 'forbidden', message: 'Request did not come from Nitpilot.' });
  });

  it('answers 409 on a closed PR: its chat is read-only', async () => {
    const { chat, dispatcher, post } = await scene();
    await dispatcher.dispatch(chat.id, { type: 'pr_closed', merged: true });
    const res = await post('maya', `/api/chats/${chat.id}/notes`, { body: 'Hello' });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: 'conflict', message: 'This PR is closed, so its chat is read-only.' });
  });
});

describe('POST /api/chats/:id/points/:n/resolve', () => {
  it('resolves P1 for the reviewer who raised it, and the chat is ready', async () => {
    const { chat, post, users } = await scene();
    await escalateP1(chat.id, users.leo);
    const res = await post('leo', `/api/chats/${chat.id}/points/1/resolve`);
    expect(res.status).toBe(200);
    expect(await prisma.point.findFirstOrThrow({ where: { chatId: chat.id, number: 1 } })).toMatchObject({ status: 'resolved' });
    expect((await prisma.prChat.findUniqueOrThrow({ where: { id: chat.id } })).phase).toBe('ready');
    const items = await prisma.message.findMany({ where: { chatId: chat.id }, orderBy: { seq: 'asc' } });
    expect(items.slice(-2).map((m) => m.body)).toEqual(['leo resolved P1', 'Ready for approval']);
  });

  it('says who may resolve instead: the author, and a GitHub point', async () => {
    const { chat, post, users } = await scene();
    await escalateP1(chat.id, users.leo);
    const asAuthor = await post('maya', `/api/chats/${chat.id}/points/1/resolve`);
    expect(asAuthor.status).toBe(403);
    expect((await errorOf(asAuthor)).message).toBe('Only the reviewer who raised P1 can resolve it.');
    await prisma.point.updateMany({ where: { chatId: chat.id }, data: { origin: 'github' } });
    const onGithub = await post('leo', `/api/chats/${chat.id}/points/1/resolve`);
    expect(onGithub.status).toBe(403);
    expect((await errorOf(onGithub)).message).toBe('P1 came from a GitHub comment: resolve its thread on GitHub.');
  });

  it('gives exactly one effect for two presses at once: one 200, one 409 that says why (Review Focus 3)', async () => {
    const { chat, post, users } = await scene();
    await escalateP1(chat.id, users.leo);
    const answers = await Promise.all([post('leo', `/api/chats/${chat.id}/points/1/resolve`), post('leo', `/api/chats/${chat.id}/points/1/resolve`)]);
    expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await errorOf(answers.find((r) => r.status === 409)!)).toEqual({ code: 'conflict', message: 'P1 is already resolved.' });
    expect(await prisma.message.count({ where: { chatId: chat.id, body: 'leo resolved P1' } })).toBe(1);
  });

  it("is a 404 for a point that doesn't exist, or a number that isn't one", async () => {
    const { chat, post, users } = await scene();
    await escalateP1(chat.id, users.leo);
    for (const n of ['9', '1e0', '01x']) {
      const res = await post('leo', `/api/chats/${chat.id}/points/${n}/resolve`);
      expect(res.status).toBe(404);
      expect(await errorOf(res)).toEqual({ code: 'not_found', message: 'No such point.' });
    }
  });
});

describe('POST /api/chats/:id/points/:n/continue', () => {
  it("hands P1 back to the agents for the author: an address job is queued for maya's agent", async () => {
    const { chat, post, users } = await scene();
    await escalateP1(chat.id, users.leo);
    const res = await post('maya', `/api/chats/${chat.id}/points/1/continue`);
    expect(res.status).toBe(200);
    expect(await prisma.point.findFirstOrThrow({ where: { chatId: chat.id, number: 1 } })).toMatchObject({ status: 'open' });
    expect(await prisma.job.findFirst({ where: { chatId: chat.id, status: 'queued' } })).toMatchObject({ type: 'address', userId: users.maya.id });
    expect((await prisma.message.findMany({ where: { chatId: chat.id }, orderBy: { seq: 'asc' } })).map((m) => m.body)).toContain('maya let the agents continue on P1');
  });

  it('refuses another reviewer (403)', async () => {
    const { chat, post, users } = await scene();
    await escalateP1(chat.id, users.leo);
    const res = await post('nina', `/api/chats/${chat.id}/points/1/continue`);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).message).toBe('Only the author or the reviewer who raised P1 can let the agents continue on it.');
  });

  it('answers 409 when P1 was resolved meanwhile (Review Focus 3)', async () => {
    const { chat, post, users } = await scene();
    await escalateP1(chat.id, users.leo);
    expect((await post('leo', `/api/chats/${chat.id}/points/1/resolve`)).status).toBe(200);
    const res = await post('maya', `/api/chats/${chat.id}/points/1/continue`);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: 'conflict', message: 'P1 is already resolved.' });
  });

  it('answers 409 when someone continued it first', async () => {
    const { chat, post, users } = await scene();
    await escalateP1(chat.id, users.leo);
    const answers = await Promise.all([post('maya', `/api/chats/${chat.id}/points/1/continue`), post('leo', `/api/chats/${chat.id}/points/1/continue`)]);
    expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await errorOf(answers.find((r) => r.status === 409)!)).message).toBe("P1 isn't escalated any more: the agents have it.");
    expect(await prisma.job.count({ where: { chatId: chat.id, type: 'address' } })).toBe(1);
  });
});

describe('POST /api/chats/:id/review', () => {
  it("starts the review of an outside contributor's PR for the requested reviewer, once", async () => {
    const { chat, post, users } = await scene({ trusted: false });
    expect(await prisma.job.count({ where: { chatId: chat.id } })).toBe(0);
    const res = await post('leo', `/api/chats/${chat.id}/review`);
    expect(res.status).toBe(200);
    expect(await prisma.job.findFirst({ where: { chatId: chat.id } })).toMatchObject({ type: 'review', status: 'queued', userId: users.leo.id });
    const again = await post('leo', `/api/chats/${chat.id}/review`);
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toEqual({ code: 'conflict', message: 'Your agent is already on it.' });
  });

  it('refuses a reviewer who is no longer requested, and anyone on a trusted PR', async () => {
    const untrusted = await scene({ trusted: false });
    expect((await untrusted.post('nina', `/api/chats/${untrusted.chat.id}/review`)).status).toBe(403);
    const trusted = await scene();
    const res = await trusted.post('leo', `/api/chats/${trusted.chat.id}/review`);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).message).toBe("Only a requested reviewer can start the review, and only on a PR from an outside contributor.");
  });
});

describe('POST /api/chats/:id/retry with the session cookie', () => {
  /** leo's review failed for good. */
  async function failedReview() {
    const s = await scene();
    const review = await prisma.job.findFirstOrThrow({ where: { chatId: s.chat.id, type: 'review', participant: { githubId: s.users.leo.githubId } } });
    await prisma.job.update({ where: { id: review.id }, data: { status: 'running', attempt: 1 } });
    await s.dispatcher.dispatch(s.chat.id, { type: 'job_failed', jobId: review.id, attempt: 1, reason: 'crash', retryable: false });
    return s;
  }

  it("queues leo's failed review again", async () => {
    const { chat, post } = await failedReview();
    const res = await post('leo', `/api/chats/${chat.id}/retry`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'queued' });
  });

  it('gives exactly one effect for two presses at once: one 200, one 409 (Review Focus 3)', async () => {
    const { chat, post } = await failedReview();
    const answers = await Promise.all([post('leo', `/api/chats/${chat.id}/retry`), post('leo', `/api/chats/${chat.id}/retry`)]);
    expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.job.count({ where: { chatId: chat.id, status: 'queued' } })).toBe(1);
  });

  it('checks the Origin and read access for a browser, and not for a CLI', async () => {
    const { chat, post, app, users } = await failedReview();
    expect((await post('leo', `/api/chats/${chat.id}/retry`, undefined, 'https://evil.example')).status).toBe(403);
    // GitHub isn't asked for a CLI's retry (Plan 1's rule): the failed flag is the person's own.
    await prisma.githubAuth.update({ where: { userId: users.leo.id }, data: { status: 'needs_reauth' } });
    const cli = await app.request(`/api/chats/${chat.id}/retry`, { method: 'POST', headers: { authorization: `Bearer ${(await makeCliToken(users.leo.id)).raw}` } });
    expect(cli.status).toBe(200);
  });
});
