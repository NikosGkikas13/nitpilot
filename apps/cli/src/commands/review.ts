import { createInterface } from 'node:readline/promises';
import { BRAND, type JobResult } from '@nitpilot/protocol';
import { adapterFor } from '../agents/registry';
import type { AgentAdapter } from '../agents/types';
import { configDir, loadConfig } from '../config/config';
import { CliError } from '../errors';
import { ciAgent, ciPullRequest, reviewedAtHead } from '../github/ci';
import { githubToken, prBundle } from '../github/pr-bundle';
import { postReview } from '../github/post-review';
import { startMcpServer } from '../mcp/server';
import { terminal, type Out } from '../out';
import type { RunProgram } from '../run-program';
import { createExecutor } from '../runner/execute';
import { reviewRepoPath } from '../runner/repo-cache';
import { parsePrRef } from './retry';

export type ReviewDeps = {
  env?: Record<string, string | undefined>;
  out?: Out;
  /** GitHub's API (tests pass a fake). */
  fetch?: typeof fetch;
  /** Runs `gh auth token` when GITHUB_TOKEN isn't set (tests pass a fake). */
  run?: RunProgram;
  /** The agent to run, instead of the one the config names (tests run the fake agent). */
  adapter?: AgentAdapter | null;
  /** Stops the review, like Ctrl-C (tests). */
  stop?: AbortSignal;
  /** `--post`: offer to post the points as your GitHub review. `--yes`: post without asking. */
  post?: boolean;
  yes?: boolean;
  /** `--ci`: on a GitHub Actions runner. The PR comes from the workflow's event, and the review is posted without asking. */
  ci?: boolean;
  /** Asks a yes/no question (tests answer it). Default: the terminal, when there is one. */
  confirm?: (question: string) => Promise<boolean>;
};

const USAGE = `Usage: ${BRAND.cli} review <pr-url> [--post [--yes]], or ${BRAND.cli} review --ci in a GitHub Actions workflow`;

/** Who posts a `--ci` review: the workflow's token is the GitHub Actions app's (its user id is the same on every repo). */
const ACTIONS_BOT = { login: 'github-actions[bot]', id: 41898282 };

/** `review`'s arguments: the PR, and the flags in any order. */
export function reviewOptions(args: string[]): { ref: string | undefined; post: boolean; yes: boolean; ci: boolean } {
  const flags = args.filter((a) => a.startsWith('--'));
  const refs = args.filter((a) => !a.startsWith('--'));
  const post = flags.includes('--post');
  const yes = flags.includes('--yes');
  const ci = flags.includes('--ci');
  // --ci reads the PR from the workflow and always posts, so it takes nothing else.
  if (ci && args.length > 1) throw new CliError(USAGE);
  if (refs.length > 1 || flags.some((f) => f !== '--post' && f !== '--yes' && f !== '--ci') || (yes && !post)) throw new CliError(USAGE);
  return { ref: refs[0], post, yes, ci };
}

/** "Post …? [y/N]" in the terminal. Anything but y or yes is a no. */
async function askInTerminal(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

/**
 * `nitpilot review <pr-url>` (spec §11 "One-off reviews"): your agent reviews one PR on this computer and prints
 * its points. No Nitpilot account, server or GitHub App: the job is built from GitHub with your own token, and the
 * same executor `nitpilot start` uses runs it. Exits 0 when the review finished (with or without points), 1 otherwise.
 * With `ci`, the same review runs on a GitHub Actions runner with the team's API key, and skips a PR Nitpilot
 * already reviewed at its head.
 */
export async function review(ref: string | undefined, deps: ReviewDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? terminal;
  const ci = deps.ci === true;
  if (ci && ref) throw new CliError(USAGE);
  const pr = ci ? ciPullRequest(env) : ref ? parsePrRef(ref) : null;
  if (ci && !pr) {
    out.log('This GitHub event has no open pull request: nothing to review.');
    return 0;
  }
  if (!pr) throw new CliError(`${USAGE}, for example ${BRAND.cli} review https://github.com/octo/sandbox/pull/12`);
  const post = deps.post || ci;
  // Asked now, not after the agent's run: with no terminal to answer in, --post needs --yes.
  const confirm = deps.yes || ci ? async () => true : (deps.confirm ?? (process.stdin.isTTY ? askInTerminal : null));
  if (post && !confirm) throw new CliError('There is no terminal to ask in, so add --yes to post the review without asking.');
  if (ci && !env.GITHUB_TOKEN) throw new CliError('GITHUB_TOKEN is not set: pass the workflow\'s token to the step.');

  const dir = configDir(env);
  const loaded = loadConfig({ env, dir });
  // A runner has no personal config: the agent comes from NITPILOT_AGENT, and its API key is let through (ci).
  const config = ci ? { ...loaded, agent: ciAgent(env) } : loaded;
  const adapter = deps.adapter !== undefined ? deps.adapter : adapterFor(config, env, { ci });
  if (!adapter || !adapter.modes.includes('reviewer')) throw new CliError(`${config.agent} can't review PRs yet. Set "agent" in ${dir}/config.json to claude-code, copilot, codex or gemini-cli.`);
  const found = await adapter.detect();
  if (!found.ok) throw new CliError(`${adapter.id} isn't ready: ${found.problem ?? 'unknown problem'} Run \`${BRAND.cli} doctor\`.`);

  const token = await githubToken(env, deps.run);
  const { bundle, rulesError } = await prBundle(pr, token, deps.fetch, ci ? { you: ACTIONS_BOT } : {});
  if (rulesError) out.error(`${rulesError}. Using the default rules.`);
  const repo = bundle.pr.repoFullName;
  if (ci && (await reviewedAtHead(bundle, token, deps.fetch))) {
    out.log(`${BRAND.name} already reviewed ${repo}#${pr.number} at ${bundle.pr.headSha.slice(0, 7)}: nothing to do.`);
    return 0;
  }
  const path = await reviewRepoPath(repo, { config, configDir: dir, env });
  // The executor only runs jobs for linked repos, so an unlinked one is linked for this run only (never saved).
  const runConfig = { ...config, repos: { ...config.repos, [repo]: config.repos[repo] ?? { path } } };

  out.log(`${adapter.id} is reviewing ${repo}#${pr.number}: ${bundle.pr.title}`);
  const stopping = new AbortController();
  const stop = () => stopping.abort();
  process.once('SIGINT', stop);
  deps.stop?.addEventListener('abort', stop, { once: true });
  const mcp = await startMcpServer({ onError: (err) => out.error(`[mcp] ${err.message}`) });
  try {
    const execute = createExecutor({ config: runConfig, configDir: dir, mcp, adapter, env, githubToken: token });
    let last = '';
    const outcome = await execute(bundle, {
      progress: (_stage, text) => {
        if (text !== last) out.log(`  ${text}`);
        last = text;
      },
      // A review never pushes; this is only here because the executor's interface has it.
      pushing: async () => 'stale',
      signal: stopping.signal,
    });
    if (outcome.kind === 'complete') {
      printReview(outcome.result, out);
      const points = outcome.result.points;
      if (!post || !confirm || points.length === 0) return 0;
      out.log('');
      const what = `${points.length} point${points.length === 1 ? '' : 's'}`;
      if (!(await confirm(`Post ${what} to ${repo}#${pr.number} as your review (@${bundle.you.login})?`))) {
        out.log('Not posted.');
        return 0;
      }
      out.log(`Posted your review: ${await postReview(bundle, points, token, deps.fetch)}`);
      return 0;
    }
    out.error(outcome.kind === 'fail' ? `The review failed (${outcome.reason}): ${outcome.detail}` : `The review couldn't start (${outcome.reason}).`);
    return 1;
  } finally {
    process.off('SIGINT', stop);
    deps.stop?.removeEventListener('abort', stop);
    await mcp.close();
  }
}

/** The review's summary, then each point: severity and category, where, the title, and the agent's explanation. */
export function printReview(result: JobResult, out: Out): void {
  out.log('');
  if (result.summary) out.log(result.summary);
  if (result.points.length === 0) {
    out.log('No points: your agent found nothing to raise.');
    return;
  }
  out.log(`${result.points.length} point${result.points.length === 1 ? '' : 's'}:`);
  for (const p of result.points) {
    out.log('');
    const where = p.path === null ? 'the whole PR' : p.line === null ? p.path : `${p.path}:${p.line}`;
    out.log(`  ${p.severity} · ${p.category}  ${where}`);
    out.log(`  ${p.title}`);
    for (const line of p.body.split('\n')) out.log(`    ${line}`);
  }
}
