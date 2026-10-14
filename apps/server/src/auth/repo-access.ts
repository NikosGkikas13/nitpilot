import { GithubError, type GithubClient } from '../platform/github/client';
import { getUserToken, NeedsReauthError } from './user-tokens';

/** How long an answer is kept: someone removed from a repo can still see its chats for this long. */
export const ACCESS_TTL_MS = 5 * 60_000;

/** The most answers kept at once. The repo name comes from the URL, so a viewer could otherwise fill the map with made-up names. */
export const MAX_ANSWERS = 1_000;

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
    private readonly maxAnswers: number = MAX_ANSWERS,
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
    this.remember(key, result);
    return result;
  }

  /**
   * Keep an answer, and never more than `maxAnswers`. A Map remembers the order keys were added in, so
   * deleting the key first moves a repeated one to the end, and the first key is always the oldest.
   */
  private remember(key: string, result: 'read' | 'none'): void {
    this.answers.delete(key);
    if (this.answers.size >= this.maxAnswers) this.answers.delete(this.answers.keys().next().value!);
    this.answers.set(key, { result, at: this.now() });
  }
}
