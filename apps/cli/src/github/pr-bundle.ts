import { randomUUID } from 'node:crypto';
import { AgentJobBundle, BRAND } from '@nitpilot/protocol';
import { parseTeamRules } from '@nitpilot/protocol/rules-file';
import { CliError } from '../errors';
import { runProgram, type RunProgram } from '../run-program';

const API = 'https://api.github.com';

/** What we read of `GET /repos/:owner/:repo/pulls/:number`. */
type GhPull = {
  title: string;
  body: string | null;
  html_url: string;
  user: { login: string } | null;
  base: { ref: string; sha: string };
  /** `repo` is null when the PR came from a fork that has since been deleted. */
  head: { ref: string; sha: string; repo: { full_name: string } | null };
};
type GhUser = { login: string; id: number };

/** Your GitHub token for one-off reviews: `GITHUB_TOKEN`, else the GitHub CLI's (`gh auth token`). */
export async function githubToken(env: Record<string, string | undefined> = process.env, run: RunProgram = runProgram): Promise<string> {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  const res = await run('gh', ['auth', 'token']);
  const token = res.code === 0 ? res.stdout.trim() : '';
  if (!token) throw new CliError('No GitHub token found. Set GITHUB_TOKEN, or sign in with the GitHub CLI: gh auth login');
  return token;
}

export type PrBundle = { bundle: AgentJobBundle; rulesError: string | null };

/**
 * The job the server would send for a review of this PR (spec §10 `job.assign`), built on this computer from
 * GitHub's API with your own token. Used by `nitpilot review`, which runs without a server.
 */
export async function prBundle(pr: { repo: string; number: number }, token: string, fetchImpl: typeof fetch = fetch): Promise<PrBundle> {
  const get = (path: string, accept = 'application/vnd.github+json') => githubGet(`${API}${path}`, token, accept, fetchImpl);
  const where = `${pr.repo}#${pr.number}`;
  const [pullRes, meRes, rulesRes] = await Promise.all([
    get(`/repos/${pr.repo}/pulls/${pr.number}`),
    get('/user'),
    // No `ref`: GitHub reads the default branch, as the server does (spec §13).
    get(`/repos/${pr.repo}/contents/${BRAND.teamConfigFile}`, 'application/vnd.github.raw+json'),
  ]);
  if (meRes.status === 401) throw new CliError('GitHub turned down your token. Check GITHUB_TOKEN, or run: gh auth login');
  if (pullRes.status === 404) throw new CliError(`Can't find ${where}: the PR doesn't exist, or your token can't see that repo.`);
  const pull = (await ok(pullRes, where)) as GhPull;
  const me = (await ok(meRes, 'your GitHub account')) as GhUser;
  const { rules, error } = parseTeamRules(rulesRes.status === 404 ? null : ((await ok(rulesRes, BRAND.teamConfigFile, 'text')) as string));

  // Parsed, so anything odd in GitHub's answer stops here and not halfway through the agent's run.
  const bundle = AgentJobBundle.parse({
    jobId: `local-${randomUUID()}`,
    attempt: 1,
    type: 'review',
    round: 1,
    maxRounds: rules.max_rounds,
    apply: 'draft',
    you: { login: me.login, githubId: String(me.id), role: 'reviewer' },
    pr: {
      repoFullName: pr.repo,
      number: pr.number,
      title: pull.title,
      body: pull.body ?? '',
      url: pull.html_url,
      authorLogin: pull.user?.login ?? '',
      baseRef: pull.base.ref,
      headRef: pull.head.ref,
      baseSha: pull.base.sha,
      headSha: pull.head.sha,
    },
    // Same as the server's gitSpecFor (apps/server/src/platform/github/mapping.ts).
    git: {
      baseCloneUrl: `https://github.com/${pr.repo}.git`,
      fetchRef: `refs/pull/${pr.number}/head`,
      headRepoPath: pull.head.repo?.full_name ?? null,
      headBranch: pull.head.ref,
    },
    sinceSha: null,
    points: [],
    notes: [],
    rules: { ignorePaths: rules.ignore_paths, alwaysEscalate: rules.always_escalate, maxPoints: rules.max_points_per_review, guidelines: rules.guidelines },
  });
  return { bundle, rulesError: error };
}

export async function githubGet(url: string, token: string, accept: string, fetchImpl: typeof fetch): Promise<Response> {
  try {
    return await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}`, accept, 'user-agent': BRAND.userAgent, 'x-github-api-version': '2022-11-28' },
    });
  } catch (err) {
    throw new CliError(`Couldn't reach GitHub: ${(err as Error).message}`);
  }
}

async function ok(res: Response, what: string, as: 'json' | 'text' = 'json'): Promise<unknown> {
  if (!res.ok) throw new CliError(`GitHub answered ${res.status} when reading ${what}.`);
  return as === 'json' ? res.json() : res.text();
}
