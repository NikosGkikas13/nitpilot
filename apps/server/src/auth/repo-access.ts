import { GithubError, type GithubClient } from '../platform/github/client';
import { getUserToken, NeedsReauthError } from './user-tokens';

/** How long an answer is kept: someone removed from a repo can still see its chats for this long. */
export const ACCESS_TTL_MS = 5 * 60_000;

/** read: GitHub shows them the repo. none: it doesn't. reauth: their GitHub sign-in has to be renewed first. */
export type RepoAccessResult = 'read' | 'none' | 'reauth';

/**
 * Who can see a chat: anyone who can read the repo on GitHub, asked with their own token (spec §16).
 * Answers are kept for 5 minutes per person and repo, so reading a chat doesn't call GitHub every time.
 */
export class RepoAccess {
  private readonly answers = new Map<string, { result: 'read' | 'none'; at: number }>();

  constructor(
    private readonly github: GithubClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async check(userId: string, repoFullName: string): Promise<RepoAccessResult> {
    const key = `${userId} ${repoFullName}`;
    const kept = this.answers.get(key);
    if (kept && this.now() - kept.at < ACCESS_TTL_MS) return kept.result;

    let token: string;
    try {
      token = await getUserToken(userId, this.github);
    } catch (err) {
      if (err instanceof NeedsReauthError) return 'reauth';
      throw err;
    }
    let result: 'read' | 'none';
    try {
      await this.github.api('GET', `/repos/${repoFullName}`, { token });
      result = 'read';
    } catch (err) {
      // 401: GitHub no longer takes the token (revoked there, say). Only signing in again helps.
      if (err instanceof GithubError && err.status === 401) return 'reauth';
      // GitHub hides a private repo you can't read behind a 404; a 403 is a plain no.
      if (err instanceof GithubError && (err.status === 404 || err.status === 403)) result = 'none';
      else throw err;
    }
    this.forgetOld();
    this.answers.set(key, { result, at: this.now() });
    return result;
  }

  /** Drop answers past their 5 minutes, so the map doesn't grow forever. */
  private forgetOld(): void {
    if (this.answers.size < 1_000) return;
    for (const [key, answer] of this.answers) {
      if (this.now() - answer.at >= ACCESS_TTL_MS) this.answers.delete(key);
    }
  }
}
