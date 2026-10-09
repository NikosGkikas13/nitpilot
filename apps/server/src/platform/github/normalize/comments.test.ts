import { describe, expect, it, vi } from 'vitest';
import { issueCommentEvent, people, reviewComment, reviewCommentEvent, reviewEvent, threadEvent } from '../../../../test/fixtures/github';
import { commentFromReviewComment, normalizeIssueComment, normalizeReview, normalizeReviewComment, normalizeReviewThread } from './comments';
import { parseGithubWebhook } from './index';

const sam = { githubId: '1003', login: 'sam', isBot: false, userId: null };

describe('review comments', () => {
  it('maps a new top-level comment, keeping the path exactly (Review Focus #5)', () => {
    const c = commentFromReviewComment(reviewComment({ path: 'src/ordres été/list v2.ts' }));
    expect(c).toEqual({ id: '9001', threadRootId: null, author: sam, trusted: true, body: 'Please handle the empty list.', path: 'src/ordres été/list v2.ts', line: 48, side: 'RIGHT', commitSha: 'a'.repeat(40) });
  });

  it('maps a reply to its thread root', () => {
    expect(commentFromReviewComment(reviewComment({ id: 9002, in_reply_to_id: 9001 })).threadRootId).toBe('9001');
  });

  it('uses original_line for an outdated comment', () => {
    expect(commentFromReviewComment(reviewComment({ line: null, original_line: 40 })).line).toBe(40);
  });

  it('is untrusted for outside contributors', () => {
    expect(commentFromReviewComment(reviewComment({ author_association: 'CONTRIBUTOR' })).trusted).toBe(false);
  });

  it('turns created and deleted into events and ignores edits', () => {
    expect(normalizeReviewComment(reviewCommentEvent('created'))[0]).toMatchObject({ scope: 'pr', snapshot: null, event: { type: 'external_comment', comment: { id: '9001' } } });
    expect(normalizeReviewComment(reviewCommentEvent('deleted'))[0]).toMatchObject({ event: { type: 'external_comment_deleted', commentId: '9001' } });
    expect(normalizeReviewComment(reviewCommentEvent('edited'))).toEqual([]);
  });
});

describe('submitted reviews', () => {
  it("fetch the review's own comments through the API (Review Focus #3)", async () => {
    const fetchComments = vi.fn(async () => [reviewComment({ id: 9101 }), reviewComment({ id: 9102 })]);
    const [ne] = await normalizeReview(reviewEvent('CHANGES_REQUESTED', { body: 'Needs work.' }), fetchComments);
    expect(fetchComments).toHaveBeenCalledWith({ installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 }, '7001');
    expect(ne).toMatchObject({
      event: { type: 'external_review_submitted', review: { id: '7001', author: sam, trusted: true, state: 'changes_requested', body: 'Needs work.', comments: [{ id: '9101' }, { id: '9102' }] } },
    });
  });

  it.each(['DISMISSED', 'PENDING'])('ignore a %s review', async (state) => {
    expect(await normalizeReview(reviewEvent(state), async () => [])).toEqual([]);
  });

  it('ignore review edits', async () => {
    expect(await normalizeReview(reviewEvent('COMMENTED', { action: 'edited' }), async () => [])).toEqual([]);
  });
});

describe('threads and conversation comments', () => {
  it('map resolved and unresolved threads to their root comment', () => {
    expect(normalizeReviewThread(threadEvent('resolved', 9001))[0]).toMatchObject({ event: { type: 'thread_resolved', threadRootId: '9001' } });
    expect(normalizeReviewThread(threadEvent('unresolved', 9001))[0]).toMatchObject({ event: { type: 'thread_unresolved', threadRootId: '9001' } });
  });

  it('map a PR conversation comment with an issue: id', () => {
    expect(normalizeIssueComment(issueCommentEvent('created'))[0]).toMatchObject({
      pr: { number: 42 },
      event: { type: 'external_comment', comment: { id: 'issue:8001', threadRootId: null, path: null, line: null } },
    });
    expect(normalizeIssueComment(issueCommentEvent('deleted'))[0]).toMatchObject({ event: { type: 'external_comment_deleted', commentId: 'issue:8001' } });
  });

  it('ignore comments on plain issues', () => {
    expect(normalizeIssueComment(issueCommentEvent('created', { onPr: false }))).toEqual([]);
  });
});

describe('parseGithubWebhook', () => {
  it('routes by event name and ignores events it does not use', async () => {
    const raw = JSON.stringify(reviewCommentEvent('created', reviewComment({ user: people.rabbit, author_association: 'NONE' })));
    const [ne] = await parseGithubWebhook('pull_request_review_comment', raw, async () => []);
    expect(ne).toMatchObject({ event: { comment: { author: { isBot: true }, trusted: false } } });
    expect(await parseGithubWebhook('ping', '{"zen":"hi"}', async () => [])).toEqual([]);
  });
});
