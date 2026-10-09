import type { NormalizedEvent } from '../../types';
import { normalizeIssueComment, normalizeReview, normalizeReviewComment, normalizeReviewThread, type FetchReviewComments } from './comments';
import { normalizePullRequest } from './pull-request';

export type { FetchReviewComments };

/** Turn one GitHub delivery into normalized events. `[]` means "nothing for us". */
export async function parseGithubWebhook(event: string, raw: string, fetchReviewComments: FetchReviewComments): Promise<NormalizedEvent[]> {
  const payload = JSON.parse(raw);
  switch (event) {
    case 'pull_request':
      return normalizePullRequest(payload);
    case 'pull_request_review_comment':
      return normalizeReviewComment(payload);
    case 'pull_request_review':
      return normalizeReview(payload, fetchReviewComments);
    case 'pull_request_review_thread':
      return normalizeReviewThread(payload);
    case 'issue_comment':
      return normalizeIssueComment(payload);
    default:
      return [];
  }
}
