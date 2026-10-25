import { BRAND } from '@nitpilot/protocol';
import type { RepoAccess, RepoAccessResult } from '../auth/repo-access';
import { HttpError } from '../http/errors';

/**
 * Keeps the rows (chats) in repos the person can still read. The inbox and the CLI's chat list both show a PR's title,
 * so a row is only for someone who can still read its repo on GitHub, checked with their own token (spec §14, §16).
 * `RepoAccess` keeps each answer for 5 minutes, and each repo is asked about once however many rows it has.
 * Throws the HTTP errors the routes pass on: `reauth` (401) and `github_unavailable` (502).
 */
export async function rowsInReposYouCanRead<T extends { repo: string }>(rows: T[], userId: string, access: RepoAccess): Promise<T[]> {
  const repos = [...new Set(rows.map((r) => r.repo))];
  let answers: RepoAccessResult[];
  try {
    answers = await Promise.all(repos.map((repo) => access.check(userId, repo)));
  } catch (err) {
    // GitHub is down, or rate limiting us: say so, rather than a bare 500.
    console.error('[repo access] could not check repo access:', err);
    throw new HttpError('github_unavailable', "GitHub didn't answer. Try again in a minute.");
  }
  if (answers.includes('reauth')) throw new HttpError('reauth', `Your GitHub sign-in expired, so ${BRAND.name} can't check which repos you can see. Sign in again.`);
  const readable = new Set(repos.filter((_, i) => answers[i] === 'read'));
  return rows.filter((r) => readable.has(r.repo));
}
