import { readFileSync } from 'node:fs';
import { BRAND, type AgentId, type AgentJobBundle } from '@nitpilot/protocol';
import { z } from 'zod';
import { apiKeyName } from '../agents/registry';
import { CliError } from '../errors';
import { githubGet } from './pr-bundle';
import { isNitpilots } from './review-comments';

/**
 * What we read of the event GitHub Actions saves at GITHUB_EVENT_PATH: `pull_request` and `pull_request_target`
 * events look the same (`review_requested` is a `pull_request` action too). Any other event has no `pull_request`.
 */
const PrEvent = z.object({
  action: z.string().optional(),
  pull_request: z.object({
    number: z.number().int().positive(),
    base: z.object({ repo: z.object({ full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/) }) }),
  }),
});

/**
 * The PR this workflow run is about, or null when there is nothing to review (another kind of event, or a closed PR),
 * so a workflow that also runs on other events doesn't fail. A missing or broken event file is an error.
 */
export function ciPullRequest(env: Record<string, string | undefined>): { repo: string; number: number } | null {
  const path = env.GITHUB_EVENT_PATH;
  if (!path) throw new CliError('GITHUB_EVENT_PATH is not set: --ci runs inside a GitHub Actions workflow.');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new CliError(`Couldn't read the GitHub event at ${path}: ${(err as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || !('pull_request' in raw)) return null;
  const event = PrEvent.safeParse(raw);
  if (!event.success) throw new CliError(`The GitHub event at ${path} has a pull_request ${BRAND.name} can't read.`);
  if (event.data.action === 'closed') return null;
  return { repo: event.data.pull_request.base.repo.full_name, number: event.data.pull_request.number };
}

/**
 * The agent a CI review runs: NITPILOT_AGENT, else Claude Code. Only the agents that run on an API key: Copilot and
 * Codex sign in with a person's login, which a runner doesn't have. Its key must be set (a repo secret).
 */
export function ciAgent(env: Record<string, string | undefined>): AgentId {
  const agent = env[`${BRAND.envPrefix}AGENT`] || 'claude-code';
  if (agent !== 'claude-code' && agent !== 'gemini-cli') {
    throw new CliError(`--ci runs claude-code or gemini-cli (they work with an API key), not ${agent}. Set ${BRAND.envPrefix}AGENT to one of them.`);
  }
  const key = apiKeyName(agent);
  if (!env[key]) throw new CliError(`${key} is not set. Add it as a repo secret and pass it to the step. (GitHub gives no secrets to PRs from forks.)`);
  return agent;
}

/** The PR's GitHub reviews, oldest first, at most 100 a page. */
type GhReview = { body: string | null; commit_id: string | null };

/**
 * True when the PR already has a review from Nitpilot (the daemon's, or a `nitpilot review` one) at its current head,
 * so CI doesn't post a second one. Checked before the agent runs: a run costs money.
 */
export async function reviewedAtHead(bundle: AgentJobBundle, token: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const { repoFullName, number, headSha } = bundle.pr;
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${repoFullName}/pulls/${number}/reviews?per_page=100&page=${page}`;
    const res = await githubGet(url, token, 'application/vnd.github+json', fetchImpl);
    if (!res.ok) throw new CliError(`GitHub answered ${res.status} when reading the PR's reviews.`);
    const reviews = (await res.json()) as GhReview[];
    if (reviews.some((r) => r.commit_id === headSha && isNitpilots((r.body ?? '').trim()))) return true;
    if (reviews.length < 100) return false;
  }
}
