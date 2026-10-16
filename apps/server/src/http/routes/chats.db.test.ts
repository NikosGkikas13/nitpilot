import { ChatResponse, FilesResponse, MessagesResponse } from '@nitpilot/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testApp } from '../../../test/app';
import { makeChat, makeGithubSignIn, makeParticipant, makeRepo, makeUser } from '../../../test/db';
import { fakeFetch, json } from '../../../test/fake-fetch';
import { sessionCookieFor } from '../../../test/http';
import { prisma } from '../../lib/prisma';
import { FakePlatform } from '../../platform/fake/fake-platform';
import { GithubClient, GithubError } from '../../platform/github/client';

afterEach(() => vi.restoreAllMocks());

/**
 * maya's chat in a repo, a reader signed in with GitHub, and what GitHub says about the reader and the repo:
 * 200 (can read), 404 (can't), or 500 (GitHub is down).
 */
async function scene(opts: { github?: 200 | 404 | 500 | 'unreachable'; signIn?: 'ok' | 'needs_reauth' } = {}) {
  const repo = await makeRepo();
  const maya = await makeUser({ login: 'maya' });
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  await makeParticipant(chat.id, maya, 'author');
  const reader = await makeUser();
  await makeGithubSignIn(reader.id, opts.signIn ?? 'ok');
  const status = opts.github ?? 200;
  const fetch = fakeFetch({
    [`GET /repos/${repo.fullName}`]: () => {
      if (status === 'unreachable') throw new TypeError('fetch failed'); // no network: the fetch itself fails
      return status === 200 ? { id: 1 } : json({ message: 'no' }, status);
    },
  });
  const platform = new FakePlatform();
  const app = testApp({ github: new GithubClient(fetch), platform });
  const cookie = await sessionCookieFor(reader.id);
  const get = (path: string) => app.request(path, { headers: { cookie } });
  return { repo, chat, reader, fetch, platform, app, get, path: `/api/chats/${repo.fullName}/${chat.number}` };
}

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

describe('GET /api/chats/:owner/:repo/:number', () => {
  it('answers the chat as the reader sees it, with its newest items', async () => {
    const { chat, get, path } = await scene();
    await prisma.message.create({ data: { chatId: chat.id, seq: 1, kind: 'system', body: 'Pull request opened by maya' } });
    await prisma.prChat.update({ where: { id: chat.id }, data: { lastSeq: 1 } });
    const res = await get(path);
    expect(res.status).toBe(200);
    const body = ChatResponse.parse(await res.json());
    expect(body.view).toMatchObject({ id: chat.id, author: 'maya', viewer: { role: null } });
    expect(body.items.map((i) => i.body)).toEqual(['Pull request opened by maya']);
  });

  it("is the same 404 for a chat that doesn't exist and one whose repo you can't see", async () => {
    const hidden = await scene({ github: 404 });
    const missing = await scene();
    const a = await hidden.get(hidden.path);
    const b = await missing.get(`/api/chats/${missing.repo.fullName}/9999`);
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(await errorOf(a)).toEqual(await errorOf(b));
  });

  it('is a 401 that says so when your GitHub sign-in expired (Review Focus 2)', async () => {
    const { get, path } = await scene({ signIn: 'needs_reauth' });
    const res = await get(path);
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toEqual({ code: 'reauth', message: 'Sign in with GitHub again to see this chat.' });
  });

  it("is a 404 without asking GitHub when the owner or repo isn't a GitHub name", async () => {
    const { get, fetch, chat } = await scene();
    expect((await get(`/api/chats/a%20b/repo/${chat.number}`)).status).toBe(404);
    expect((await get('/api/chats/octo/repo/not-a-number')).status).toBe(404);
    expect(fetch.calls).toEqual([]);
  });

  it("is a 502 that says so when GitHub doesn't answer", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { get, path } = await scene({ github: 500 });
    const res = await get(path);
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe('github_unavailable');
  });

  it("is a 502, not a 500, when GitHub can't be reached at all", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { get, path } = await scene({ github: 'unreachable' });
    const res = await get(path);
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe('github_unavailable');
    expect(console.error).toHaveBeenCalledWith('[chats] GitHub did not answer:', expect.stringContaining("Couldn't reach GitHub"));
  });

  it('asks GitHub once for the inbox and the chat together: they share one access answer', async () => {
    const { repo, chat, reader, fetch, get, path } = await scene();
    await makeParticipant(chat.id, reader, 'reviewer');
    expect((await get('/api/inbox')).status).toBe(200);
    expect((await get(path)).status).toBe(200);
    expect(fetch.calls.filter((c) => c.url.pathname === `/repos/${repo.fullName}`)).toHaveLength(1);
  });

  it('is a 401 without a session', async () => {
    const { app, path } = await scene();
    expect((await app.request(path)).status).toBe(401);
  });
});

describe('GET /api/chats/:id/messages?before=', () => {
  it('pages backwards, 200 at a time', async () => {
    const { chat, get } = await scene();
    await prisma.message.createMany({ data: Array.from({ length: 250 }, (_, i) => ({ chatId: chat.id, seq: i + 1, kind: 'system', body: `item ${i + 1}` })) });
    const first = MessagesResponse.parse(await (await get(`/api/chats/${chat.id}/messages`)).json());
    expect([first.items[0]!.seq, first.items.at(-1)!.seq, first.hasOlder]).toEqual([51, 250, true]);
    const older = MessagesResponse.parse(await (await get(`/api/chats/${chat.id}/messages?before=51`)).json());
    expect([older.items.length, older.items[0]!.seq, older.hasOlder]).toEqual([50, 1, false]);
    expect((await get(`/api/chats/${chat.id}/messages?before=zero`)).status).toBe(400);
  });

  it("is a 404 for a chat you can't see", async () => {
    const { chat, get } = await scene({ github: 404 });
    expect((await get(`/api/chats/${chat.id}/messages`)).status).toBe(404);
  });
});

describe('GET /api/chats/:id/files', () => {
  it('lists the changed files with their totals, asking GitHub once per head commit', async () => {
    const { repo, chat, get, platform } = await scene();
    platform.prFiles.set(`${repo.fullName}#${chat.number}`, [
      { path: 'locales/tr.json', oldPath: null, status: 'added', adds: 412, dels: 0 },
      { path: 'src/i18n.ts', oldPath: null, status: 'modified', adds: 3, dels: 1 },
    ]);
    const body = FilesResponse.parse(await (await get(`/api/chats/${chat.id}/files`)).json());
    expect(body).toMatchObject({ adds: 415, dels: 1, truncated: false });
    expect(body.files.map((f) => f.path)).toEqual(['locales/tr.json', 'src/i18n.ts']);
    await get(`/api/chats/${chat.id}/files`);
    expect(platform.fileLists).toHaveLength(1);
    // A push: a new head, a new list.
    await prisma.prChat.update({ where: { id: chat.id }, data: { headSha: 'd'.repeat(40) } });
    await get(`/api/chats/${chat.id}/files`);
    expect(platform.fileLists).toHaveLength(2);
  });

  it("is a 404 for a chat you can't see, without asking for its files", async () => {
    const { chat, get, platform } = await scene({ github: 404 });
    expect((await get(`/api/chats/${chat.id}/files`)).status).toBe(404);
    expect(platform.fileLists).toEqual([]);
  });
});

describe('the same access answers on messages and files', () => {
  const routes = (chatId: string) => [`/api/chats/${chatId}/messages`, `/api/chats/${chatId}/files`];

  it('are a 401 reauth when your GitHub sign-in expired', async () => {
    const { chat, get, platform } = await scene({ signIn: 'needs_reauth' });
    for (const route of routes(chat.id)) {
      const res = await get(route);
      expect(res.status).toBe(401);
      expect(await errorOf(res)).toEqual({ code: 'reauth', message: 'Sign in with GitHub again to see this chat.' });
    }
    expect(platform.fileLists).toEqual([]);
  });

  it("are a 502 github_unavailable when GitHub doesn't answer the access check", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { chat, get, platform } = await scene({ github: 500 });
    for (const route of routes(chat.id)) {
      const res = await get(route);
      expect(res.status).toBe(502);
      expect((await errorOf(res)).code).toBe('github_unavailable');
    }
    expect(platform.fileLists).toEqual([]);
  });

  it('answer a 502 when the file list fails, and ask the platform again next time (a failure is not kept)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { repo, chat, get, platform } = await scene();
    const file = { path: 'src/a.ts', oldPath: null, status: 'modified' as const, adds: 1, dels: 0 };
    platform.prFiles.set(`${repo.fullName}#${chat.number}`, [file]);
    vi.spyOn(platform, 'listPrFiles').mockRejectedValueOnce(new GithubError(503, null, 'GitHub down'));
    const failed = await get(`/api/chats/${chat.id}/files`);
    expect(failed.status).toBe(502);
    expect((await errorOf(failed)).code).toBe('github_unavailable');
    const retried = await get(`/api/chats/${chat.id}/files`);
    expect(retried.status).toBe(200);
    expect(FilesResponse.parse(await retried.json()).files).toEqual([file]);
    expect(platform.listPrFiles).toHaveBeenCalledTimes(2);
  });
});
