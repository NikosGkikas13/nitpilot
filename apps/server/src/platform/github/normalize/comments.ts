import type { ExternalComment } from '../../../engine/types';
import type { NormalizedEvent, PrRef } from '../../types';
import type { GhIssueCommentEvent, GhReviewComment, GhReviewCommentEvent, GhReviewEvent, GhReviewThreadEvent } from '../payloads';
import { isTrustedAssociation, toPerson } from '../mapping';
import { prRefFrom } from './pull-request';

export type FetchReviewComments = (ref: PrRef, reviewId: string) => Promise<GhReviewComment[]>;

export function commentFromReviewComment(c: GhReviewComment): ExternalComment {
  return {
    id: String(c.id),
    threadRootId: c.in_reply_to_id ? String(c.in_reply_to_id) : null,
    author: toPerson(c.user),
    trusted: isTrustedAssociation(c.author_association),
    body: c.body,
    path: c.path ?? null,
    line: c.line ?? c.original_line ?? null,
    side: c.side ?? null,
    commitSha: c.commit_id ?? null,
  };
}

export function normalizeReviewComment(p: GhReviewCommentEvent): NormalizedEvent[] {
  const pr = prRefFrom(p, p.pull_request.number);
  if (p.action === 'created') return [{ scope: 'pr', pr, snapshot: null, event: { type: 'external_comment', comment: commentFromReviewComment(p.comment) } }];
  if (p.action === 'deleted') return [{ scope: 'pr', pr, snapshot: null, event: { type: 'external_comment_deleted', commentId: String(p.comment.id) } }];
  return [];
}

const REVIEW_STATES = { approved: 'approved', changes_requested: 'changes_requested', commented: 'commented' } as const;

/** A submitted review, with its comments fetched through the API so webhook order doesn't matter. */
export async function normalizeReview(p: GhReviewEvent, fetchComments: FetchReviewComments): Promise<NormalizedEvent[]> {
  if (p.action !== 'submitted') return [];
  const state = REVIEW_STATES[p.review.state.toLowerCase() as keyof typeof REVIEW_STATES];
  if (!state) return []; // dismissed, pending
  const pr = prRefFrom(p, p.pull_request.number);
  const reviewId = String(p.review.id);
  const comments = (await fetchComments(pr, reviewId)).map(commentFromReviewComment);
  return [
    {
      scope: 'pr',
      pr,
      snapshot: null,
      event: {
        type: 'external_review_submitted',
        review: {
          id: reviewId,
          author: toPerson(p.review.user),
          trusted: isTrustedAssociation(p.review.author_association),
          state,
          body: p.review.body ?? '',
          comments,
        },
      },
    },
  ];
}

export function normalizeReviewThread(p: GhReviewThreadEvent): NormalizedEvent[] {
  const root = p.thread.comments[0];
  if (!root) return [];
  const pr = prRefFrom(p, p.pull_request.number);
  const threadRootId = String(root.id);
  if (p.action === 'resolved') return [{ scope: 'pr', pr, snapshot: null, event: { type: 'thread_resolved', threadRootId } }];
  if (p.action === 'unresolved') return [{ scope: 'pr', pr, snapshot: null, event: { type: 'thread_unresolved', threadRootId } }];
  return [];
}

/** A comment in the PR's conversation tab. GitHub models PRs as issues, hence `issue_comment`. */
export function normalizeIssueComment(p: GhIssueCommentEvent): NormalizedEvent[] {
  if (!p.issue.pull_request) return []; // a plain issue, not a PR
  const pr = prRefFrom(p, p.issue.number);
  const id = `issue:${p.comment.id}`;
  if (p.action === 'deleted') return [{ scope: 'pr', pr, snapshot: null, event: { type: 'external_comment_deleted', commentId: id } }];
  if (p.action !== 'created') return [];
  const comment: ExternalComment = {
    id,
    threadRootId: null,
    author: toPerson(p.comment.user),
    trusted: isTrustedAssociation(p.comment.author_association),
    body: p.comment.body,
    path: null,
    line: null,
    side: null,
    commitSha: null,
  };
  return [{ scope: 'pr', pr, snapshot: null, event: { type: 'external_comment', comment } }];
}
