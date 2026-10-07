import type { Person } from '../../engine/types';
import type { GitSpec, PrRef, PrSnapshot } from '../types';
import type { GhPull, GhUser } from './payloads';

// Pure helpers that turn GitHub's shapes into ours. No I/O, so the normalizers can use them too.

/** A GitHub user as the engine sees them. The router fills in `userId` later. */
export function toPerson(u: GhUser): Person {
  return { githubId: String(u.id), login: u.login, isBot: u.type === 'Bot', userId: null };
}

/** Trusted = OWNER, MEMBER or COLLABORATOR of the repo (spec §6.1). Trusted bots are added by the router. */
export function isTrustedAssociation(association: string | undefined): boolean {
  return association === 'OWNER' || association === 'MEMBER' || association === 'COLLABORATOR';
}

export function snapshotFromPull(ref: PrRef, pull: GhPull): PrSnapshot {
  return {
    ref,
    title: pull.title,
    body: pull.body ?? '',
    url: pull.html_url,
    state: pull.state,
    merged: pull.merged === true,
    isDraft: pull.draft === true,
    author: toPerson(pull.user),
    authorAssociation: pull.author_association,
    requestedReviewers: (pull.requested_reviewers ?? []).map(toPerson),
    headSha: pull.head.sha,
    baseSha: pull.base.sha,
    headRef: pull.head.ref,
    baseRef: pull.base.ref,
    headRepoFullName: pull.head.repo?.full_name ?? null,
  };
}

/** Fetch PR code from the base repo's `refs/pull/N/head`, which works for forks too (spec §11). */
export function gitSpecFor(pr: PrSnapshot): GitSpec {
  return {
    baseCloneUrl: `https://github.com/${pr.ref.repoFullName}.git`,
    fetchRef: `refs/pull/${pr.ref.number}/head`,
    headRepoPath: pr.headRepoFullName,
    headBranch: pr.headRef,
  };
}
