import type { AnchoredComment, PrRef, WriteOptions } from '../types';
import type { AppAuth } from './app-auth';
import { GithubError, type GithubClient } from './client';

export type WriteContext = {
  github: GithubClient;
  appAuth: AppAuth;
  /** The user's GitHub token (auth/user-tokens.ts). Throws NeedsReauthError when they must sign in again. */
  userToken: (userId: string) => Promise<string>;
};

const repoPath = (pr: PrRef) => `/repos/${pr.repoFullName}`;

/** The summary comment, as the app bot (spec §15). Edited in place; recreated if someone deleted it. */
export async function upsertSummary(ctx: WriteContext, pr: PrRef, body: string, existingId?: string, opts: WriteOptions = {}): Promise<{ id: string }> {
  const token = await ctx.appAuth.installationToken(pr.installationId);
  const edit = async (id: string) => {
    await ctx.github.api('PATCH', `${repoPath(pr)}/issues/comments/${id}`, { token, body: { body } });
    return { id };
  };

  if (existingId) {
    try {
      return await edit(existingId);
    } catch (err) {
      if (!(err instanceof GithubError && err.status === 404)) throw err;
    }
  }
  if (opts.reuseIfContains) {
    const found = await findIssueComment(ctx, token, pr, opts.reuseIfContains);
    if (found) return edit(found);
  }
  const { data } = await ctx.github.api<{ id: number }>('POST', `${repoPath(pr)}/issues/${pr.number}/comments`, { token, body: { body } });
  return { id: String(data.id) };
}

/** One review with inline comments, as the user. Always COMMENT: approving stays a human act. */
export async function postReview(
  ctx: WriteContext,
  asUser: string,
  pr: PrRef,
  r: { commitSha: string; body: string; comments: AnchoredComment[] },
  opts: WriteOptions = {},
): Promise<{ reviewId: string; commentIds: string[] }> {
  const token = await ctx.userToken(asUser);
  if (opts.reuseIfContains) {
    const { data: reviews } = await ctx.github.api<{ id: number; body: string | null }[]>('GET', `${repoPath(pr)}/pulls/${pr.number}/reviews?per_page=100`, { token });
    const existing = reviews.find((rv) => rv.body?.includes(opts.reuseIfContains!));
    if (existing) return { reviewId: String(existing.id), commentIds: await reviewCommentIds(ctx, token, pr, existing.id) };
  }
  const { data } = await ctx.github.api<{ id: number }>('POST', `${repoPath(pr)}/pulls/${pr.number}/reviews`, {
    token,
    body: {
      commit_id: r.commitSha,
      body: r.body,
      event: 'COMMENT',
      comments: r.comments.map((c) => ({ path: c.path, line: c.line, side: c.side, body: c.body })),
    },
  });
  return { reviewId: String(data.id), commentIds: await reviewCommentIds(ctx, token, pr, data.id) };
}

/** A reply where the point was raised, as the user (spec §6.1). */
export async function replyToThread(ctx: WriteContext, asUser: string, pr: PrRef, threadRootId: string, body: string, opts: WriteOptions = {}): Promise<{ id: string }> {
  const token = await ctx.userToken(asUser);

  // Conversation comments and review bodies have no threads on GitHub: answer with a new PR comment.
  if (threadRootId.startsWith('issue:') || threadRootId.startsWith('review:')) {
    const found = opts.reuseIfContains ? await findIssueComment(ctx, token, pr, opts.reuseIfContains) : null;
    if (found) return { id: `issue:${found}` };
    const { data } = await ctx.github.api<{ id: number }>('POST', `${repoPath(pr)}/issues/${pr.number}/comments`, { token, body: { body } });
    return { id: `issue:${data.id}` };
  }

  if (opts.reuseIfContains) {
    const { data } = await ctx.github.api<{ id: number; in_reply_to_id?: number; body: string }[]>('GET', `${repoPath(pr)}/pulls/${pr.number}/comments?per_page=100`, { token });
    const found = data.find((c) => String(c.in_reply_to_id) === threadRootId && c.body.includes(opts.reuseIfContains!));
    if (found) return { id: String(found.id) };
  }
  const { data } = await ctx.github.api<{ id: number }>('POST', `${repoPath(pr)}/pulls/${pr.number}/comments/${threadRootId}/replies`, { token, body: { body } });
  return { id: String(data.id) };
}

/** The ids of a review's inline comments, oldest first, which is the order we sent them. */
async function reviewCommentIds(ctx: WriteContext, token: string, pr: PrRef, reviewId: number): Promise<string[]> {
  const { data } = await ctx.github.api<{ id: number }[]>('GET', `${repoPath(pr)}/pulls/${pr.number}/reviews/${reviewId}/comments?per_page=100`, { token });
  return data.map((c) => c.id).sort((a, b) => a - b).map(String);
}

/** Looks through the first 100 PR comments for one carrying `marker`. */
async function findIssueComment(ctx: WriteContext, token: string, pr: PrRef, marker: string): Promise<string | null> {
  const { data } = await ctx.github.api<{ id: number; body: string | null }[]>('GET', `${repoPath(pr)}/issues/${pr.number}/comments?per_page=100`, { token });
  const found = data.find((c) => c.body?.includes(marker));
  return found ? String(found.id) : null;
}
