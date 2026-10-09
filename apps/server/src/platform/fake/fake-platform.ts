import { GithubError } from '../github/client';
import { parseGithubWebhook } from '../github/normalize/index';
import type { GhReviewComment } from '../github/payloads';
import { gitSpecFor } from '../github/mapping';
import type { AnchoredComment, GitSpec, GitSpecInput, NormalizedEvent, PlatformAdapter, PrRef, PrSnapshot, RepoRef, WriteOptions } from '../types';

export type FakeWrite = {
  kind: 'summary' | 'review' | 'reply';
  id: string;
  pr: PrRef;
  asUser: string | null;
  body: string;
  edits: number;
  comments: AnchoredComment[];
  commentIds: string[];
  threadRootId: string | null;
};

const prKey = (pr: PrRef) => `${pr.repoFullName}#${pr.number}`;

/**
 * GitHub in memory, for tests (spec §19 "FakePlatform"). It parses real GitHub-shaped payloads,
 * serves PRs and files that tests put in, and records every write in `writes`.
 */
export class FakePlatform implements PlatformAdapter {
  readonly id = 'github' as const;
  readonly prs = new Map<string, PrSnapshot>();
  /** `${repoFullName}:${path}` → file text on the default branch */
  readonly files = new Map<string, string>();
  /** review id → that review's comments, for parseWebhook */
  readonly reviewComments = new Map<string, GhReviewComment[]>();
  readonly writes: FakeWrite[] = [];
  /** Make the next postReview with inline comments fail like GitHub does for lines outside the diff. */
  rejectNextInlineReview = false;
  private nextId = Date.now() * 1000;

  addPr(snapshot: PrSnapshot): void {
    this.prs.set(prKey(snapshot.ref), snapshot);
  }

  writesFor(pr: PrRef, kind: FakeWrite['kind']): FakeWrite[] {
    return this.writes.filter((w) => w.kind === kind && prKey(w.pr) === prKey(pr));
  }

  async parseWebhook(h: Headers, raw: string): Promise<NormalizedEvent[]> {
    return parseGithubWebhook(h.get('x-github-event') ?? '', raw, async (_ref, reviewId) => this.reviewComments.get(reviewId) ?? []);
  }

  async getPr(pr: PrRef): Promise<PrSnapshot> {
    const snapshot = this.prs.get(prKey(pr));
    if (!snapshot) throw new Error(`FakePlatform: no PR ${prKey(pr)}`);
    return snapshot;
  }

  async readDefaultBranchFile(repo: RepoRef, path: string, etag?: string): Promise<{ text: string; etag: string } | 'not_modified' | null> {
    const text = this.files.get(`${repo.repoFullName}:${path}`);
    if (text === undefined) return null;
    const current = `fake-etag-${text.length}`;
    return etag === current ? 'not_modified' : { text, etag: current };
  }

  gitSpec(pr: GitSpecInput): GitSpec {
    return gitSpecFor(pr);
  }

  async upsertSummary(pr: PrRef, body: string, existingId?: string, opts?: WriteOptions): Promise<{ id: string }> {
    const existing =
      this.writes.find((w) => w.kind === 'summary' && w.id === existingId) ??
      (opts?.reuseIfContains ? this.find('summary', pr, opts.reuseIfContains) : undefined);
    if (existing) {
      existing.body = body;
      existing.edits += 1;
      return { id: existing.id };
    }
    return { id: this.record({ kind: 'summary', pr, asUser: null, body }).id };
  }

  async postReview(asUser: string, pr: PrRef, r: { commitSha: string; body: string; comments: AnchoredComment[] }, opts?: WriteOptions): Promise<{ reviewId: string; commentIds: string[] }> {
    const reused = opts?.reuseIfContains ? this.find('review', pr, opts.reuseIfContains) : undefined;
    if (reused) return { reviewId: reused.id, commentIds: reused.commentIds };
    if (this.rejectNextInlineReview && r.comments.length > 0) {
      this.rejectNextInlineReview = false;
      throw new GithubError(422, { message: 'Line could not be resolved' }, 'GitHub POST reviews failed with 422');
    }
    const commentIds = r.comments.map(() => String(this.nextId++));
    const w = this.record({ kind: 'review', pr, asUser, body: r.body, comments: r.comments, commentIds });
    return { reviewId: w.id, commentIds };
  }

  async replyToThread(asUser: string, pr: PrRef, threadRootId: string, body: string, opts?: WriteOptions): Promise<{ id: string }> {
    const reused = opts?.reuseIfContains ? this.find('reply', pr, opts.reuseIfContains) : undefined;
    if (reused) return { id: reused.id };
    return { id: this.record({ kind: 'reply', pr, asUser, body, threadRootId }).id };
  }

  async redeliverFailed(): Promise<number> {
    return 0;
  }

  private find(kind: FakeWrite['kind'], pr: PrRef, marker: string): FakeWrite | undefined {
    return this.writes.find((w) => w.kind === kind && prKey(w.pr) === prKey(pr) && w.body.includes(marker));
  }

  private record(w: Pick<FakeWrite, 'kind' | 'pr' | 'asUser' | 'body'> & Partial<FakeWrite>): FakeWrite {
    const write: FakeWrite = { id: String(this.nextId++), edits: 0, comments: [], commentIds: [], threadRootId: null, ...w };
    this.writes.push(write);
    return write;
  }
}
