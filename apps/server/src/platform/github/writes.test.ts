import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fakeFetch, json } from '../../../test/fake-fetch';
import { AppAuth } from './app-auth';
import { GithubClient } from './client';
import { postReview, replyToThread, upsertSummary, type WriteContext } from './writes';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const pr = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 };

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const fetch = fakeFetch({ 'POST /app/installations/77/access_tokens': () => ({ token: 'ghs_bot', expires_at: '2099-01-01T00:00:00Z' }), ...routes });
  const github = new GithubClient(fetch);
  const ctx: WriteContext = { github, appAuth: new AppAuth(github, '12345', pem), userToken: async (userId) => `ghu_${userId}` };
  return { fetch, ctx, calls: (route: string) => fetch.calls.filter((c) => `${c.method} ${c.url.pathname}` === route) };
}

describe('upsertSummary', () => {
  it('posts a new comment as the app bot', async () => {
    const { ctx, calls } = setup({ 'POST /repos/octo/sandbox/issues/42/comments': () => ({ id: 555 }) });
    expect(await upsertSummary(ctx, pr, 'summary')).toEqual({ id: '555' });
    expect(calls('POST /repos/octo/sandbox/issues/42/comments')[0]!.headers.get('authorization')).toBe('Bearer ghs_bot');
  });

  it('edits the existing comment in place', async () => {
    const { ctx, calls } = setup({ 'PATCH /repos/octo/sandbox/issues/comments/555': () => ({ id: 555 }) });
    expect(await upsertSummary(ctx, pr, 'v2', '555')).toEqual({ id: '555' });
    expect(calls('PATCH /repos/octo/sandbox/issues/comments/555')[0]!.body).toEqual({ body: 'v2' });
  });

  it('posts a new one when someone deleted the old comment', async () => {
    const { ctx } = setup({
      'PATCH /repos/octo/sandbox/issues/comments/555': () => json({ message: 'Not Found' }, 404),
      'POST /repos/octo/sandbox/issues/42/comments': () => ({ id: 556 }),
    });
    expect(await upsertSummary(ctx, pr, 'v2', '555')).toEqual({ id: '556' });
  });

  it('on a retry, reuses the comment that already carries the marker (Review Focus #2)', async () => {
    const { ctx, calls } = setup({
      'GET /repos/octo/sandbox/issues/42/comments': () => [{ id: 1, body: 'hello' }, { id: 557, body: '<!-- nitpilot:v1 chat=c1 -->\nold' }],
      'PATCH /repos/octo/sandbox/issues/comments/557': () => ({ id: 557 }),
    });
    expect(await upsertSummary(ctx, pr, 'new', undefined, { reuseIfContains: '<!-- nitpilot:v1 chat=c1 -->' })).toEqual({ id: '557' });
    expect(calls('POST /repos/octo/sandbox/issues/42/comments')).toEqual([]);
  });
});

describe('postReview', () => {
  const review = {
    commitSha: 'c'.repeat(40),
    body: 'Review <!-- m -->',
    comments: [{ path: 'src/ordres été/list v2.ts', line: 48, side: 'RIGHT' as const, body: 'P1', diffRefs: { base: 'b', head: 'c' } }],
  };

  it('posts one COMMENT review as the user and returns its comment ids in order', async () => {
    const { ctx, calls } = setup({
      'POST /repos/octo/sandbox/pulls/42/reviews': () => ({ id: 900 }),
      'GET /repos/octo/sandbox/pulls/42/reviews/900/comments': () => [{ id: 12 }, { id: 11 }],
    });
    expect(await postReview(ctx, 'user-leo', pr, review)).toEqual({ reviewId: '900', commentIds: ['11', '12'] });
    const post = calls('POST /repos/octo/sandbox/pulls/42/reviews')[0]!;
    expect(post.headers.get('authorization')).toBe('Bearer ghu_user-leo');
    // The path goes through exactly as given (Review Focus #5).
    expect(post.body).toEqual({ commit_id: 'c'.repeat(40), body: 'Review <!-- m -->', event: 'COMMENT', comments: [{ path: 'src/ordres été/list v2.ts', line: 48, side: 'RIGHT', body: 'P1' }] });
  });

  it('on a retry, reuses a review that already carries the marker (Review Focus #2)', async () => {
    const { ctx, calls } = setup({
      'GET /repos/octo/sandbox/pulls/42/reviews': () => [{ id: 901, body: 'Review <!-- m -->' }],
      'GET /repos/octo/sandbox/pulls/42/reviews/901/comments': () => [{ id: 21 }],
    });
    expect(await postReview(ctx, 'user-leo', pr, review, { reuseIfContains: '<!-- m -->' })).toEqual({ reviewId: '901', commentIds: ['21'] });
    expect(calls('POST /repos/octo/sandbox/pulls/42/reviews')).toEqual([]);
  });
});

describe('replyToThread', () => {
  it('replies in a review comment thread as the user', async () => {
    const { ctx, calls } = setup({ 'POST /repos/octo/sandbox/pulls/42/comments/9001/replies': () => ({ id: 77 }) });
    expect(await replyToThread(ctx, 'user-maya', pr, '9001', 'Fixed.')).toEqual({ id: '77' });
    expect(calls('POST /repos/octo/sandbox/pulls/42/comments/9001/replies')[0]!.headers.get('authorization')).toBe('Bearer ghu_user-maya');
  });

  it('answers a conversation comment with a new PR comment', async () => {
    const { ctx } = setup({ 'POST /repos/octo/sandbox/issues/42/comments': () => ({ id: 78 }) });
    expect(await replyToThread(ctx, 'user-maya', pr, 'issue:8001', 'Done.')).toEqual({ id: 'issue:78' });
  });

  it('on a retry, reuses a reply that already carries the marker', async () => {
    const { ctx, calls } = setup({ 'GET /repos/octo/sandbox/pulls/42/comments': () => [{ id: 79, in_reply_to_id: 9001, body: 'Fixed. <!-- r -->' }] });
    expect(await replyToThread(ctx, 'user-maya', pr, '9001', 'Fixed. <!-- r -->', { reuseIfContains: '<!-- r -->' })).toEqual({ id: '79' });
    expect(calls('POST /repos/octo/sandbox/pulls/42/comments/9001/replies')).toEqual([]);
  });
});
