import type { JobResult } from '@nitpilot/protocol';
import { describe, expect, it, vi } from 'vitest';
import { testApp } from '../../../test/app';
import { makeChat, makeRepo, makeUser, personOf } from '../../../test/db';
import { fakeFetch, json } from '../../../test/fake-fetch';
import { sessionCookieFor } from '../../../test/http';
import type { LiveClis } from '../../chats/activity';
import { Dispatcher } from '../../chats/dispatch';
import { encrypt } from '../../lib/crypto';
import { prisma } from '../../lib/prisma';
import { GithubClient } from '../../platform/github/client';

/** A GitHub sign-in for `userId`, as saveGithubUser stores one. */
async function githubAuthFor(userId: string, status: 'ok' | 'needs_reauth' = 'ok') {
  const later = new Date(Date.now() + 86_400_000);
  await prisma.githubAuth.create({ data: { userId, accessTokenEnc: encrypt(`ghu_${userId}`), accessExpiresAt: later, refreshTokenEnc: encrypt('ghr_x'), refreshExpiresAt: later, status } });
}

/** The page as a reader sees it: tags gone, entities decoded, spaces collapsed. */
async function textOf(res: Response): Promise<string> {
  const entities: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };
  return (await res.text()).replace(/<[^>]+>/g, ' ').replace(/&(lt|gt|quot|#39|amp);/g, (e) => entities[e]!).replace(/\s+/g, ' ');
}

const result = (over: Partial<JobResult>): JobResult => ({ summary: 'Done.', points: [], decisions: [], replies: [], push: null, ...over });

/**
 * maya's PR: leo's agent raised P1 and P2, maya's agent fixed P1 and declined P2, and leo's re-review is
 * queued, but leo's CLI isn't connected. `canRead` is what GitHub says about the viewer and the repo
 * (`revoked`: GitHub no longer takes the viewer's token; `githubDown`: it answers 500); `clis` are the connected CLIs (none by default).
 */
async function scene(opts: { canRead?: boolean; forbidden?: boolean; revoked?: boolean; githubDown?: boolean; clis?: (leoId: string) => LiveClis } = {}) {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const repo = await makeRepo();
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  const dispatcher = new Dispatcher();
  const runJob = async (r: JobResult) => {
    const job = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id, status: 'queued' } });
    await prisma.job.update({ where: { id: job.id }, data: { status: 'running', attempt: 1 } });
    await dispatcher.dispatch(chat.id, { type: 'job_completed', jobId: job.id, attempt: 1, result: r });
  };
  await dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
  const point = { path: 'src/orders.ts', line: 1, side: 'RIGHT' as const, severity: 'major' as const, category: 'bug' as const };
  await runJob(result({
    summary: 'Two things.',
    points: [
      { ...point, title: 'Page size 50 is too big', body: 'Use 20.', snippet: { startLine: 1, lines: ['export const pageSize = 50;'] } },
      { ...point, severity: 'nit', category: 'style', title: 'Rename <script>alert(1)</script>', body: 'Call it `limit`.', snippet: null },
    ],
  }));
  await runJob(result({ replies: [{ point: 1, resolution: 'fixed', comment: 'Now 20.' }, { point: 2, resolution: 'declined', comment: 'Kept for the API.' }] }));

  const github = fakeFetch({ [`GET /repos/${repo.fullName}`]: () => (opts.githubDown ? json({ message: 'Server Error' }, 500) : opts.revoked ? json({ message: 'Bad credentials' }, 401) : opts.canRead === false ? json({ message: 'Not Found' }, 404) : opts.forbidden ? json({ message: 'Resource not accessible' }, 403) : { id: Number(repo.id) }) });
  const app = testApp({ github: new GithubClient(github), dispatch: dispatcher.dispatch, ...(opts.clis ? { clis: opts.clis(leo.id) } : {}) });
  const path = `/c/${repo.fullName}/${chat.number}`;
  const view = async (viewerId: string | null, at = path) => app.request(at, { headers: viewerId ? { cookie: await sessionCookieFor(viewerId) } : {} });
  return { maya, leo, repo, chat, github, path, view };
}

describe('GET /c/:owner/:repo/:number (spec §10 "Transcript")', () => {
  it('sends someone who is not signed in to sign in, and back here after', async () => {
    const { path, view } = await scene();
    const res = await view(null);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/auth/github/login?next=${encodeURIComponent(path)}`);
  });

  it("answers 404 when GitHub says the viewer can't read the repo, and when there's no such chat", async () => {
    const { maya, repo, view } = await scene({ canRead: false });
    await githubAuthFor(maya.id);
    expect((await view(maya.id)).status).toBe(404);
    expect((await view(maya.id, `/c/${repo.fullName}/999`)).status).toBe(404);
  });

  it("shows 'Nothing here' when GitHub answers a plain 403 (no rate limit), like a 404", async () => {
    const { maya, view } = await scene({ forbidden: true });
    await githubAuthFor(maya.id);
    const res = await view(maya.id);
    expect(res.status).toBe(404);
    expect(await textOf(res)).toContain('Nothing here');
  });

  it("answers a chat that doesn't exist like one that does, for a viewer who must sign in again (it must not tell which chats exist)", async () => {
    const { maya, repo, view } = await scene({ revoked: true });
    await githubAuthFor(maya.id);
    expect((await view(maya.id)).status).toBe(401);
    const missing = await view(maya.id, `/c/${repo.fullName}/999`);
    expect(missing.status).toBe(401);
    expect(await missing.text()).toContain(`href="/auth/github/login?next=${encodeURIComponent(`/c/${repo.fullName}/999`)}"`);
  });

  it("answers 404 for a chat number that doesn't exist, to a viewer who can read the repo", async () => {
    const { maya, repo, view } = await scene();
    await githubAuthFor(maya.id);
    expect((await view(maya.id, `/c/${repo.fullName}/999`)).status).toBe(404);
  });

  it("doesn't ask GitHub about an owner or repo that isn't shaped like a GitHub name", async () => {
    const { maya, view, github } = await scene();
    await githubAuthFor(maya.id);
    expect((await view(maya.id, '/c/octo/re%3Fpo/1')).status).toBe(404);
    expect((await view(maya.id, '/c/oc%20to/repo/1')).status).toBe(404);
    expect((await view(maya.id, '/c/octo/..%2Fx/1')).status).toBe(404);
    expect(github.calls).toEqual([]);
  });

  it("shows a page, not a crash, when GitHub doesn't answer the access check", async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { maya, view } = await scene({ githubDown: true });
    await githubAuthFor(maya.id);
    const res = await view(maya.id);
    expect(res.status).toBe(502);
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(await textOf(res)).toContain("GitHub didn't answer");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('asks a viewer whose GitHub sign-in expired to sign in again', async () => {
    const { maya, path, view, github } = await scene();
    await githubAuthFor(maya.id, 'needs_reauth');
    const res = await view(maya.id);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain(`href="/auth/github/login?next=${encodeURIComponent(path)}"`);
    expect(github.calls).toEqual([]);
  });

  it('shows the header, who the chat waits on, and the timeline in order with point cards', async () => {
    const { maya, repo, chat, view } = await scene();
    await githubAuthFor(maya.id);
    const res = await view(maya.id);
    expect(res.status).toBe(200);
    const text = await textOf(res);
    expect(text).toContain(`PR ${chat.number}`);
    expect(text).toContain(`${repo.fullName}#${chat.number} · Reviewing · round 2 of 3`);
    expect(text).toContain("leo's agent is waiting: their CLI hasn't connected yet");
    const order = ['Pull request opened by maya', 'P1', 'Page size 50 is too big', 'Addressed: fixed', 'Now 20.', 'P2', 'Addressed: declined', 'Kept for the API.'];
    const at = order.map((s) => text.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).toContain('src/orders.ts:1');
    expect(text).toContain('export const pageSize = 50;');
  });

  it("says why an agent waits: offline since its CLI was last seen, or the repo isn't linked on its connected CLI", async () => {
    const offline = await scene();
    await githubAuthFor(offline.maya.id);
    await prisma.cliToken.create({ data: { userId: offline.leo.id, name: 'laptop', tokenHash: `hash-${offline.leo.id}`, prefix: 'nit_x', lastSeenAt: new Date('2026-10-15T09:30:00Z') } });
    expect(await textOf(await offline.view(offline.maya.id))).toContain("leo's agent is waiting: offline since 2026-10-15 09:30 UTC");

    const unlinked = await scene({ clis: (leoId) => ({ connectionsFor: (userId) => (userId === leoId ? [{ repos: new Set(['octo/other']) }] : []) }) });
    await githubAuthFor(unlinked.maya.id);
    expect(await textOf(await unlinked.view(unlinked.maya.id))).toContain(`leo's agent is waiting: ${unlinked.repo.fullName} isn't linked on leo's connected CLI`);
  });

  it("shows a human's reply in a point's GitHub thread inside that point's card", async () => {
    const { maya, chat, view } = await scene();
    await githubAuthFor(maya.id);
    await prisma.point.update({ where: { chatId_number: { chatId: chat.id, number: 1 } }, data: { githubCommentId: 'gh-comment-1' } });
    const last = await prisma.message.findFirstOrThrow({ where: { chatId: chat.id }, orderBy: { seq: 'desc' } });
    await prisma.message.create({ data: { chatId: chat.id, seq: last.seq + 1, kind: 'human', authorGithubId: maya.githubId, authorLogin: 'maya', body: 'Thanks, will do.', data: { threadRootId: 'gh-comment-1' } } });
    const text = await textOf(await view(maya.id));
    const at = ['Page size 50 is too big', 'maya: Thanks, will do.', 'Rename <script>'].map((s) => text.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("shows when the repo's .nitpilot.yml has a problem", async () => {
    const { maya, repo, view } = await scene();
    await githubAuthFor(maya.id);
    await prisma.repo.update({ where: { id: repo.id }, data: { rulesError: 'max_rounds must be a number' } });
    expect(await textOf(await view(maya.id))).toContain('.nitpilot.yml has a problem, so the defaults apply: max_rounds must be a number');
  });

  it('says in words whether a finished chat was merged or closed, and why a point escalated', async () => {
    const { maya, chat, view } = await scene();
    await githubAuthFor(maya.id);
    await prisma.prChat.update({ where: { id: chat.id }, data: { phase: 'closed', merged: true } });
    expect(await textOf(await view(maya.id))).toContain(`#${chat.number} · Merged ·`);
    await prisma.prChat.update({ where: { id: chat.id }, data: { merged: false } });
    expect(await textOf(await view(maya.id))).toContain(`#${chat.number} · Closed ·`);
    await prisma.point.update({ where: { chatId_number: { chatId: chat.id, number: 2 } }, data: { status: 'escalated', escalationReason: 'round_limit' } });
    expect(await textOf(await view(maya.id))).toContain('Escalated: round limit');
  });

  it('escapes what agents and people wrote', async () => {
    const { maya, view } = await scene();
    await githubAuthFor(maya.id);
    const html = await (await view(maya.id)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('asks GitHub about access once, then remembers it', async () => {
    const { maya, view, github } = await scene();
    await githubAuthFor(maya.id);
    await view(maya.id);
    await view(maya.id);
    expect(github.calls).toHaveLength(1);
    expect(github.calls[0]!.headers.get('authorization')).toBe(`Bearer ghu_${maya.id}`);
  });

  it('may not be shown inside another site (frame-ancestors), like every server page', async () => {
    const { maya, view } = await scene();
    await githubAuthFor(maya.id);
    expect((await view(maya.id)).headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    // The web app's pages say the same (http/spa.ts).
    expect((await testApp().request('/')).headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});
