import type { PrFile } from '@nitpilot/protocol';
import { MAX_PR_FILES, type FoundPr, type GitSpec, type GitSpecInput, type NormalizedEvent, type PlatformReads, type PrRef, type PrSnapshot, type RepoRef, type UserInstallation } from '../types';
import type { AppAuth } from './app-auth';
import { GithubError, type GithubClient } from './client';
import { gitSpecFor, snapshotFromPull } from './mapping';
import { parseGithubWebhook } from './normalize/index';
import type { GhPrFile, GhPull, GhReviewComment } from './payloads';

export { gitSpecFor, isTrustedAssociation, snapshotFromPull, toPerson } from './mapping';

/** What a search answers, as far as we read it. */
type GhSearch = { items: { number: number; repository_url: string }[] };

/** What `GET /user/installations` answers, as far as we read it. */
type GhUserInstallations = { installations: { id: number; account: { login: string } | null }[] };

/** The read side of the GitHub adapter. Task 26 adds the writes. */
export class GithubReads implements PlatformReads {
  readonly id = 'github' as const;

  constructor(
    protected readonly github: GithubClient,
    protected readonly appAuth: AppAuth,
    /** A person's own GitHub token (auth/user-tokens.ts), for what only they can see. */
    protected readonly userToken: (userId: string) => Promise<string>,
  ) {}

  async parseWebhook(h: Headers, raw: string): Promise<NormalizedEvent[]> {
    return parseGithubWebhook(h.get('x-github-event') ?? '', raw, (ref, reviewId) => this.reviewComments(ref, reviewId));
  }

  /** The comments that belong to one submitted review. */
  async reviewComments(ref: PrRef, reviewId: string): Promise<GhReviewComment[]> {
    const token = await this.appAuth.installationToken(ref.installationId);
    const { data } = await this.github.api<GhReviewComment[]>('GET', `/repos/${ref.repoFullName}/pulls/${ref.number}/reviews/${reviewId}/comments?per_page=100`, { token });
    return data;
  }

  async getPr(ref: PrRef): Promise<PrSnapshot> {
    const token = await this.appAuth.installationToken(ref.installationId);
    const { data } = await this.github.api<GhPull>('GET', `/repos/${ref.repoFullName}/pulls/${ref.number}`, { token });
    return snapshotFromPull(ref, data);
  }

  /** Read a file from the default branch. `etag` makes an unchanged file cost nothing (304). */
  async readDefaultBranchFile(repo: RepoRef, path: string, etag?: string): Promise<{ text: string; etag: string } | 'not_modified' | null> {
    const token = await this.appAuth.installationToken(repo.installationId);
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    try {
      const res = await this.github.api<unknown>('GET', `/repos/${repo.repoFullName}/contents/${encoded}`, {
        token,
        accept: 'application/vnd.github.raw+json',
        headers: etag ? { 'if-none-match': etag } : {},
      });
      if (res.status === 304) return 'not_modified';
      const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
      return { text, etag: res.headers.get('etag') ?? '' };
    } catch (err) {
      if (err instanceof GithubError && err.status === 404) return null;
      throw err;
    }
  }

  gitSpec(pr: GitSpecInput): GitSpec {
    return gitSpecFor(pr);
  }

  /**
   * Three searches with the person's own token, one page of 100 each (spec §15 "Catching up"). Search
   * allows 30 requests a minute per person, and a catch-up uses 3.
   */
  async findOpenPrsFor(user: { id: string; login: string }): Promise<FoundPr[]> {
    const token = await this.userToken(user.id);
    const found = new Map<string, FoundPr>();
    for (const filter of [`author:${user.login}`, `review-requested:${user.login}`, `reviewed-by:${user.login}`]) {
      const q = encodeURIComponent(`is:pr is:open ${filter}`);
      const { data } = await this.github.api<GhSearch>('GET', `/search/issues?q=${q}&per_page=100`, { token });
      for (const item of data.items) {
        // repository_url is https://api.github.com/repos/<owner>/<name>
        const repoFullName = item.repository_url.split('/repos/')[1];
        if (repoFullName) found.set(`${repoFullName}#${item.number}`, { repoFullName, number: item.number });
      }
    }
    return [...found.values()];
  }

  /**
   * With a GitHub App's user token, `GET /user/installations` lists only this app's installations the person can
   * reach: on their own account, or on an org where they can see it. The first 100 are plenty to say "installed".
   */
  async userInstallations(userId: string): Promise<UserInstallation[]> {
    const token = await this.userToken(userId);
    const { data } = await this.github.api<GhUserInstallations>('GET', '/user/installations?per_page=100', { token });
    return data.installations.map((i) => ({ id: String(i.id), accountLogin: i.account?.login ?? '' }));
  }

  /** Page by page, 100 at a time, with the installation token, up to MAX_PR_FILES. */
  async listPrFiles(ref: PrRef): Promise<{ files: PrFile[]; truncated: boolean }> {
    const token = await this.appAuth.installationToken(ref.installationId);
    const files: PrFile[] = [];
    for (let page = 1; files.length < MAX_PR_FILES; page++) {
      const { data } = await this.github.api<GhPrFile[]>('GET', `/repos/${ref.repoFullName}/pulls/${ref.number}/files?per_page=100&page=${page}`, { token });
      files.push(...data.map(toPrFile));
      if (data.length < 100) return { files, truncated: false };
    }
    return { files, truncated: true };
  }
}

/** GitHub's file statuses, as the four the web app shows: a copy is new, a mode change is a change. */
function toPrFile(f: GhPrFile): PrFile {
  const status = f.status === 'copied' ? 'added' : f.status === 'changed' || f.status === 'unchanged' ? 'modified' : f.status;
  return { path: f.filename, oldPath: f.status === 'renamed' ? (f.previous_filename ?? null) : null, status, adds: f.additions, dels: f.deletions };
}
