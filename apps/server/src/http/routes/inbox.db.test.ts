import { InboxResponse } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { testApp } from '../../../test/app';
import { makeChat, makeMessage, makeParticipant, makeRepo, makeUser } from '../../../test/db';
import { json } from '../../../test/fake-fetch';
import { sessionCookieFor } from '../../../test/http';
import { encrypt } from '../../lib/crypto';
import { prisma } from '../../lib/prisma';
import { GithubClient, type FetchLike } from '../../platform/github/client';

const ORIGIN = 'http://localhost:8787'; // PUBLIC_URL in test/test-env.ts

/** A GitHub sign-in for `userId`, as saveGithubUser stores one. */
async function githubAuthFor(userId: string) {
  const later = new Date(Date.now() + 86_400_000);
  await prisma.githubAuth.create({ data: { userId, accessTokenEnc: encrypt(`ghu_${userId}`), accessExpiresAt: later, refreshTokenEnc: encrypt('ghr_x'), refreshExpiresAt: later, status: 'ok' } });
}

/**
 * maya's PR with leo reviewing, and six items in its timeline, all written by leo. GitHub lets maya read
 * every repo unless a test sets `githubStatus` for one (`githubStatus.set(repo.fullName, 404)`); `githubCalls`
 * lists the GitHub requests the server made. `signedIn: false` = maya never signed in with GitHub.
 */
async function scene(opts: { signedIn?: boolean } = {}) {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const repo = await makeRepo();
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  await makeParticipant(chat.id, maya, 'author');
  await makeParticipant(chat.id, leo, 'reviewer', { requested: true });
  for (let i = 0; i < 6; i++) await makeMessage(chat.id, leo);
  if (opts.signedIn !== false) await githubAuthFor(maya.id);

  const githubStatus = new Map<string, number>();
  const githubCalls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const path = new URL(input).pathname;
    githubCalls.push(path);
    const status = githubStatus.get(path.replace('/repos/', '')) ?? 200;
    return status === 200 ? json({ id: 1 }) : json({ message: 'no' }, status);
  };
  const app = testApp({ github: new GithubClient(fetchImpl) });
  const cookie = await sessionCookieFor(maya.id);
  const getInbox = () => app.request('/api/inbox', { headers: { cookie } });
  const inbox = async () => {
    const res = await getInbox();
    expect(res.status).toBe(200);
    return InboxResponse.parse(await res.json());
  };
  /** Another PR of maya's, in a repo of its own. */
  const otherRepoChat = async () => {
    const other = await makeRepo();
    const otherChat = await makeChat(other.id, { authorGithubId: maya.githubId });
    await makeParticipant(otherChat.id, maya, 'author');
    return { repo: other, chat: otherChat };
  };
  const read = (seq: unknown, headers: Record<string, string> = { origin: ORIGIN }, chatId = chat.id) =>
    app.request(`/api/chats/${chatId}/read`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...headers }, body: JSON.stringify({ seq }) });
  return { maya, leo, repo, chat, app, cookie, githubStatus, githubCalls, getInbox, inbox, otherRepoChat, read };
}

/** The `{ error: { code, message } }` body of a refused request. */
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

describe('GET /api/inbox', () => {
  it('lists the signed-in person’s chats', async () => {
    const { chat, inbox } = await scene();
    const { rows } = await inbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chatId: chat.id, role: 'author', unread: 6 });
  });

  it('is a 401 for a browser that is not signed in', async () => {
    expect((await testApp().request('/api/inbox')).status).toBe(401);
  });

  it('leaves out the chats of a repo GitHub no longer shows the person, and keeps the others', async () => {
    const { repo, chat, githubStatus, otherRepoChat, inbox } = await scene();
    const other = await otherRepoChat();
    githubStatus.set(repo.fullName, 404);
    const ids = (await inbox()).rows.map((r) => r.chatId);
    expect(ids).toEqual([other.chat.id]);
    expect(ids).not.toContain(chat.id);
  });

  it('is a 401 that says to sign in again when GitHub no longer takes the person’s token', async () => {
    const { repo, githubStatus, getInbox } = await scene();
    githubStatus.set(repo.fullName, 401);
    const res = await getInbox();
    expect(res.status).toBe(401);
    expect((await errorOf(res)).message).toMatch(/sign in again/i);
  });

  it('is the same 401 when the person never signed in with GitHub', async () => {
    const { getInbox } = await scene({ signedIn: false });
    const res = await getInbox();
    expect(res.status).toBe(401);
    expect((await errorOf(res)).message).toMatch(/sign in again/i);
  });

  it('is a 502 when GitHub does not answer', async () => {
    const { repo, githubStatus, getInbox } = await scene();
    githubStatus.set(repo.fullName, 500);
    const res = await getInbox();
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe('github_unavailable');
  });

  it('asks GitHub once per repo, however many chats the repo has', async () => {
    const { maya, leo, repo, githubCalls, inbox } = await scene();
    const second = await makeChat(repo.id, { authorGithubId: maya.githubId });
    await makeParticipant(second.id, maya, 'author');
    await makeParticipant(second.id, leo, 'reviewer', { requested: true });
    expect((await inbox()).rows).toHaveLength(2);
    expect(githubCalls).toEqual([`/repos/${repo.fullName}`]);
  });
});

describe('POST /api/chats/:id/read', () => {
  it('is a 401 without a session', async () => {
    const { app, chat } = await scene();
    const res = await app.request(`/api/chats/${chat.id}/read`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ seq: 1 }) });
    expect(res.status).toBe(401);
  });

  it('moves the read cursor, so only later items count as unread', async () => {
    const { read, inbox } = await scene();
    expect((await read(5)).status).toBe(204);
    expect((await inbox()).rows[0]!.unread).toBe(1);
  });

  it('never moves the cursor back', async () => {
    const { read, inbox } = await scene();
    await read(5);
    expect((await read(2)).status).toBe(204);
    expect((await inbox()).rows[0]!.unread).toBe(1);
  });

  it('stops at the newest item, so items that arrive later are unread', async () => {
    const { leo, chat, read, inbox } = await scene();
    await read(999);
    await makeMessage(chat.id, leo);
    expect((await inbox()).rows[0]!.unread).toBe(1);
  });

  it("is a 404 for a chat you're not part of, or one that doesn't exist", async () => {
    const { read } = await scene();
    const outsider = await scene();
    expect((await read(1, { origin: ORIGIN }, outsider.chat.id)).status).toBe(404);
    expect((await read(1, { origin: ORIGIN }, 'no-such-chat')).status).toBe(404);
  });

  it('is a 403 from another site (the Origin check), and a 400 for a bad seq', async () => {
    const { read } = await scene();
    expect((await read(1, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await read(-1)).status).toBe(400);
  });

  it('stores one cursor per person and chat, however many times it is called', async () => {
    const { maya, chat, read } = await scene();
    await Promise.all([read(3), read(4), read(2)]);
    const rows = await prisma.chatRead.findMany({ where: { userId: maya.id, chatId: chat.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lastReadSeq).toBe(4);
  });
});
