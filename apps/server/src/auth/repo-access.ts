import { TtlCache } from '../lib/ttl-cache';
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
  private readonly answers: TtlCache<'read' | 'none'>;

  constructor(
    private readonly github: GithubClient,
    now: () => number = () => Date.now(),
    maxAnswers: number = MAX_ANSWERS,
  ) {
    // The repo name comes from the URL, so the cache is bounded: a viewer can't grow it with made-up names.
    this.answers = new TtlCache(ACCESS_TTL_MS, maxAnswers, now);
  }

  async check(userId: string, repoFullName: string): Promise<RepoAccessResult> {
    const key = `${userId} ${repoFullName}`;
    const kept = this.answers.get(key);
    if (kept) return kept;

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
      // A 403 that says when to retry is GitHub's rate limit, not a no: pass it on, and don't remember it.
      if (err instanceof GithubError && err.status === 403 && err.retryAfterMs !== undefined) throw err;
      // GitHub hides a private repo you can't read behind a 404; a plain 403 is a no too.
      if (err instanceof GithubError && (err.status === 404 || err.status === 403)) result = 'none';
      else throw err;
    }
    this.answers.set(key, result);
    return result;
  }
}
