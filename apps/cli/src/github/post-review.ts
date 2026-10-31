import { BRAND, sanitizeForGithub, type AgentJobBundle, type NewPoint } from '@nitpilot/protocol';
import { CliError } from '../errors';

/** What `POST /repos/:owner/:repo/pulls/:number/reviews` takes. Always COMMENT: approving stays a human act. */
export type ReviewRequest = {
  commit_id: string;
  body: string;
  event: 'COMMENT';
  comments: { path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }[];
};

/**
 * The review the server's review handler would post (apps/server/src/tasks/handlers/review.ts), plus a line saying
 * where the agent came from. Points on a line become inline comments; the rest go in the body, unless `allInBody`.
 * Everything the agent wrote goes through sanitizeForGithub first (spec §14.6): only the author and you may be mentioned.
 */
export function reviewRequest(bundle: AgentJobBundle, points: NewPoint[], opts: { allInBody?: boolean } = {}): ReviewRequest {
  const clean = (text: string, maxLength: number) => sanitizeForGithub(text, { allowedMentions: [bundle.you.login, bundle.pr.authorLogin], maxLength });
  const text = (p: NewPoint, i: number) => `**P${i + 1} · ${p.severity} · ${p.category}:** ${clean(p.title, 200)}\n\n${clean(p.body, 4000)}`;
  const numbered = points.map((p, i) => ({ p, text: text(p, i) }));
  const inline = opts.allInBody ? [] : numbered.filter(({ p }) => p.path && p.line);
  const header = `🤖 Review by ${bundle.you.login}'s agent · ${BRAND.name}`;
  const footer = `<sub>Run with \`${BRAND.cli} review\` · [get your own agent reviewer](https://${BRAND.hostedDomain})</sub>`;
  return {
    commit_id: bundle.pr.headSha,
    body: [header, ...numbered.filter((n) => !inline.includes(n)).map((n) => n.text), footer].join('\n\n'),
    event: 'COMMENT',
    comments: inline.map(({ p, text }) => ({ path: p.path!, line: p.line!, side: p.side ?? 'RIGHT', body: text })),
  };
}

/** Post the points as one GitHub review, as you, and return its address. */
export async function postReview(bundle: AgentJobBundle, points: NewPoint[], token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = `https://api.github.com/repos/${bundle.pr.repoFullName}/pulls/${bundle.pr.number}/reviews`;
  const send = (body: ReviewRequest) =>
    fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': BRAND.userAgent, 'x-github-api-version': '2022-11-28' },
      body: JSON.stringify(body),
    }).catch((err: Error) => {
      throw new CliError(`Couldn't reach GitHub: ${err.message}`);
    });

  let res = await send(reviewRequest(bundle, points));
  // GitHub refuses inline comments on lines outside the diff: put every point in the review body, as the server does.
  if (res.status === 422) res = await send(reviewRequest(bundle, points, { allInBody: true }));
  if (!res.ok) {
    const hint = res.status === 403 || res.status === 404 ? ' Your token may not be allowed to review PRs on this repo.' : '';
    throw new CliError(`GitHub answered ${res.status} when posting the review.${hint}`);
  }
  const { html_url } = (await res.json()) as { html_url?: string };
  return html_url ?? bundle.pr.url;
}
