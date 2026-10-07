import type { GitSpec, PrRef, PrSnapshot, RepoRef } from '../types';
import type { AppAuth } from './app-auth';
import { GithubError, type GithubClient } from './client';
import { gitSpecFor, snapshotFromPull } from './mapping';
import type { GhPull } from './payloads';

export { gitSpecFor, isTrustedAssociation, snapshotFromPull, toPerson } from './mapping';

/** The read side of the GitHub adapter. Task 21 adds parseWebhook; Task 26 adds the writes. */
export class GithubReads {
  readonly id = 'github' as const;

  constructor(
    protected readonly github: GithubClient,
    protected readonly appAuth: AppAuth,
  ) {}

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

  gitSpec(pr: PrSnapshot): GitSpec {
    return gitSpecFor(pr);
  }
}
