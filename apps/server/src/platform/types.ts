import type { DomainEvent, Person } from '../engine/types';

/** Which PR, on which installation. All ids are strings (spec §8). */
export type PrRef = { installationId: string; repoId: string; repoFullName: string; number: number };
export type RepoRef = Omit<PrRef, 'number'>;

/** What the server needs to know about a PR. */
export type PrSnapshot = {
  ref: PrRef;
  title: string;
  body: string;
  url: string;
  state: 'open' | 'closed';
  merged: boolean;
  isDraft: boolean;
  author: Person;
  /** GitHub's author_association: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, … */
  authorAssociation: string;
  requestedReviewers: Person[];
  headSha: string;
  baseSha: string;
  headRef: string;
  baseRef: string;
  /** null when the PR came from a fork that has been deleted */
  headRepoFullName: string | null;
};

/** How the CLI fetches the code (spec §11). `headRepoPath` null = nowhere to push. */
export type GitSpec = { baseCloneUrl: string; fetchRef: string; headRepoPath: string | null; headBranch: string };

export type AnchoredComment = {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  body: string;
  diffRefs: { base: string; head: string; start?: string };
};

export type RepoInfo = { id: string; fullName: string; private: boolean; defaultBranch: string };

export type PrNormalizedEvent = {
  scope: 'pr';
  pr: PrRef;
  /** Set when the webhook carried the full PR (pull_request events); otherwise null. */
  snapshot: PrSnapshot | null;
  event: DomainEvent;
};

export type NormalizedEvent =
  | PrNormalizedEvent
  | { scope: 'installation'; action: 'created' | 'deleted' | 'suspend' | 'unsuspend'; installationId: string; accountLogin: string; repos: RepoInfo[] }
  | { scope: 'installation_repos'; installationId: string; accountLogin: string; added: RepoInfo[]; removed: string[] }
  | { scope: 'repo'; action: 'privatized' | 'publicized' | 'deleted' | 'renamed'; installationId: string; repo: RepoInfo };

/** Reading from a code platform (spec §12.1). */
export interface PlatformReads {
  readonly id: 'github' | 'gitlab';
  /** [] means "nothing for us here". May call the platform's API. */
  parseWebhook(h: Headers, raw: string): Promise<NormalizedEvent[]>;
  getPr(pr: PrRef): Promise<PrSnapshot>;
  readDefaultBranchFile(repo: RepoRef, path: string, etag?: string): Promise<{ text: string; etag: string } | 'not_modified' | null>;
  gitSpec(pr: PrSnapshot): GitSpec;
}

/** On a retry, first look for an earlier write whose body contains this marker, and reuse it. */
export type WriteOptions = { reuseIfContains?: string };

/** Writing to a code platform (spec §12.1). */
export interface PlatformWrites {
  /** The summary comment, as the app bot. */
  upsertSummary(pr: PrRef, body: string, existingId?: string, opts?: WriteOptions): Promise<{ id: string }>;
  /** One review (COMMENT), as the user `asUser` (a Nitpilot user id). */
  postReview(asUser: string, pr: PrRef, r: { commitSha: string; body: string; comments: AnchoredComment[] }, opts?: WriteOptions): Promise<{ reviewId: string; commentIds: string[] }>;
  /** A reply in a comment thread, as the user. */
  replyToThread(asUser: string, pr: PrRef, threadRootId: string, body: string, opts?: WriteOptions): Promise<{ id: string }>;
  redeliverFailed?(since: Date): Promise<number>;
}

export type PlatformAdapter = PlatformReads & PlatformWrites;
