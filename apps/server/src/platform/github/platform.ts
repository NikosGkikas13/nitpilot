import type { AnchoredComment, PlatformAdapter, PrRef, WriteOptions } from '../types';
import type { AppAuth } from './app-auth';
import type { GithubClient } from './client';
import { GithubReads } from './reads';
import { postReview, replyToThread, upsertSummary, type WriteContext } from './writes';

/** The complete GitHub adapter (spec §12.1): reads, webhook parsing and writes. */
export class GithubPlatform extends GithubReads implements PlatformAdapter {
  private readonly writeCtx: WriteContext;

  constructor(github: GithubClient, appAuth: AppAuth, userToken: (userId: string) => Promise<string>) {
    super(github, appAuth);
    this.writeCtx = { github, appAuth, userToken };
  }

  upsertSummary(pr: PrRef, body: string, existingId?: string, opts?: WriteOptions) {
    return upsertSummary(this.writeCtx, pr, body, existingId, opts);
  }

  postReview(asUser: string, pr: PrRef, r: { commitSha: string; body: string; comments: AnchoredComment[] }, opts?: WriteOptions) {
    return postReview(this.writeCtx, asUser, pr, r, opts);
  }

  replyToThread(asUser: string, pr: PrRef, threadRootId: string, body: string, opts?: WriteOptions) {
    return replyToThread(this.writeCtx, asUser, pr, threadRootId, body, opts);
  }
}
