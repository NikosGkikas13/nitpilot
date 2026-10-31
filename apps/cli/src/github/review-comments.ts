import { BRAND } from '@nitpilot/protocol';
import { CliError } from '../errors';
import { isFolderName } from '../runner/worktree';
import { githubGet } from './pr-bundle';

/** One past review comment a person left on the repo. The body is untrusted text: anyone can comment on a public repo. */
export type ReviewComment = { author: string; path: string; body: string; url: string; createdAt: string };

/** What we read of each item of `GET /repos/:owner/:repo/pulls/comments`. */
type GhReviewComment = {
  user: { login: string; type: string } | null;
  path: string;
  body: string;
  html_url: string;
  created_at: string;
};

export const MAX_COMMENTS = 100;
export const MAX_BODY_CHARS = 1000;
const PER_PAGE = 100;
/** Bots and tiny replies can fill whole pages; stop after this many rather than read a repo's entire history. */
const MAX_PAGES = 3;

/**
 * The repo's most recent review comments written by people (newest first), for `nitpilot rules suggest` to learn
 * the team's habits from. Skips bots, Nitpilot's own writes, and replies too short to teach anything.
 */
export async function recentReviewComments(repo: string, token: string, fetchImpl: typeof fetch = fetch): Promise<ReviewComment[]> {
  const parts = repo.split('/');
  // The name goes into the URL, so `../` or `?` must never get this far.
  if (parts.length !== 2 || !parts.every(isFolderName)) throw new CliError(`"${repo}" isn't a repo name. Use owner/name, like acme/shop-api.`);

  const kept: ReviewComment[] = [];
  for (let page = 1; page <= MAX_PAGES && kept.length < MAX_COMMENTS; page++) {
    const url = `https://api.github.com/repos/${repo}/pulls/comments?sort=created&direction=desc&per_page=${PER_PAGE}&page=${page}`;
    const res = await githubGet(url, token, 'application/vnd.github+json', fetchImpl);
    if (res.status === 401) throw new CliError('GitHub turned down your token. Check GITHUB_TOKEN, or run: gh auth login');
    if (res.status === 403 || res.status === 404) throw new CliError(`Can't read ${repo}'s review comments: the repo doesn't exist, or your token can't see it.`);
    if (!res.ok) throw new CliError(`GitHub answered ${res.status} when reading ${repo}'s review comments.`);
    const items = (await res.json()) as GhReviewComment[];
    for (const c of items) {
      if (kept.length === MAX_COMMENTS) break;
      if (!isHumanReview(c)) continue;
      kept.push({ author: c.user!.login, path: c.path, body: c.body.trim().slice(0, MAX_BODY_CHARS), url: c.html_url, createdAt: c.created_at });
    }
    if (items.length < PER_PAGE) break;
  }
  return kept;
}

function isHumanReview(c: GhReviewComment): boolean {
  if (!c.user || c.user.type === 'Bot' || c.user.login.endsWith('[bot]')) return false;
  const body = (c.body ?? '').trim();
  if (isNitpilots(body)) return false;
  return !saysNothing(body);
}

/** The marker the server puts in everything it writes, and the shapes `nitpilot review` posts (apps/cli/src/github/post-review.ts). */
function isNitpilots(body: string): boolean {
  return (
    body.includes(`<!-- ${BRAND.commentMarker}`) ||
    body.startsWith('🤖 Review by ') ||
    body.includes(`Run with \`${BRAND.cli} review\``) ||
    /^\*\*P\d+ · /.test(body)
  );
}

/** "+1", "LGTM", "Thanks, fixed!": nothing for the agent to learn from. */
function saysNothing(body: string): boolean {
  const words = body.toLowerCase().match(/[a-z0-9+']+/g) ?? [];
  if (words.length < 3) return true;
  // shortcut: a word-count guess, so "thanks, but this still leaks the handle" is kept; tune if real repos slip through.
  return /^(thanks|thank|thx|ty)$/.test(words[0]!) && words.length <= 6;
}
