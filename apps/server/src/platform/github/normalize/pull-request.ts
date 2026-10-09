import type { DomainEvent } from '../../../engine/types';
import type { NormalizedEvent, PrRef } from '../../types';
import type { GhPullRequestEvent } from '../payloads';
import { snapshotFromPull, toPerson } from '../mapping';

/** The PrRef for any event that has `installation` and `repository`. */
export function prRefFrom(payload: { installation: { id: number }; repository: { id: number; full_name: string } }, number: number): PrRef {
  return {
    installationId: String(payload.installation.id),
    repoId: String(payload.repository.id),
    repoFullName: payload.repository.full_name,
    number,
  };
}

/** `pull_request` webhooks → domain events (spec §9 DomainEvent). */
export function normalizePullRequest(p: GhPullRequestEvent): NormalizedEvent[] {
  const ref = prRefFrom(p, p.pull_request.number);
  const snapshot = snapshotFromPull(ref, p.pull_request);
  const one = (event: DomainEvent): NormalizedEvent[] => [{ scope: 'pr', pr: ref, snapshot, event }];

  switch (p.action) {
    case 'opened':
      return one({ type: 'pr_opened', author: snapshot.author, reviewers: snapshot.requestedReviewers });
    case 'reopened':
      return one({ type: 'pr_reopened' });
    case 'ready_for_review':
      return one({ type: 'pr_ready' });
    case 'converted_to_draft':
      return one({ type: 'pr_to_draft' });
    case 'closed':
      return one({ type: 'pr_closed', merged: p.pull_request.merged === true });
    case 'review_requested':
      // Team review requests are out of scope for v1 (spec §18).
      return p.requested_reviewer ? one({ type: 'review_requested', reviewer: toPerson(p.requested_reviewer) }) : [];
    case 'review_request_removed':
      return p.requested_reviewer ? one({ type: 'review_request_removed', reviewer: toPerson(p.requested_reviewer) }) : [];
    case 'synchronize':
      return one({ type: 'head_updated', before: p.before ?? '', after: p.after ?? p.pull_request.head.sha, ours: false });
    default:
      return [];
  }
}
