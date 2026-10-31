import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BRAND } from '@nitpilot/protocol';
import { stringify } from 'yaml';
import { rulesSuggestPrompt } from '../agents/prompt';
import { adapterFor } from '../agents/registry';
import { agentBaseEnv, runAgent } from '../agents/runner';
import type { AgentAdapter } from '../agents/types';
import { configDir, loadConfig } from '../config/config';
import { CliError } from '../errors';
import { gitTopLevel, githubReposIn } from '../git/remotes';
import { githubToken } from '../github/pr-bundle';
import { recentReviewComments } from '../github/review-comments';
import { rulesSuggestTools } from '../mcp/job-tools';
import { startMcpServer } from '../mcp/server';
import { terminal, type Out } from '../out';
import type { RunProgram } from '../run-program';
import { MAX_TURNS } from '../runner/execute';

export type RulesSuggestDeps = {
  env?: Record<string, string | undefined>;
  out?: Out;
  /** GitHub's API (tests pass a fake). */
  fetch?: typeof fetch;
  /** Runs `gh auth token` when GITHUB_TOKEN isn't set (tests pass a fake). */
  run?: RunProgram;
  /** The agent to run, instead of the one the config names (tests run the fake agent). */
  adapter?: AgentAdapter | null;
  /** Where to look for a GitHub remote when no repo is given. Default: the current folder. */
  cwd?: string;
  /** Stops the run, like Ctrl-C (tests). */
  stop?: AbortSignal;
};

export const RULES_USAGE = `Usage: ${BRAND.cli} rules suggest [owner/name]`;

/**
 * `nitpilot rules suggest [owner/name]` (spec §11, §13): your agent reads the repo's recent human review comments
 * and drafts `.nitpilot.yml` guidelines from the habits it finds. It only prints a YAML block to paste: nothing is
 * written or committed. No Nitpilot account needed, like `nitpilot review`. Exits 0 when the agent's run finished.
 */
export async function rulesSuggest(repoArg: string | undefined, deps: RulesSuggestDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? terminal;
  const repo = repoArg ?? (await repoHere(deps.cwd ?? process.cwd()));

  const dir = configDir(env);
  const config = loadConfig({ env, dir });
  const adapter = deps.adapter !== undefined ? deps.adapter : adapterFor(config, env);
  if (!adapter || !adapter.modes.includes('reviewer')) throw new CliError(`${config.agent} can't do this yet. Set "agent" in ${dir}/config.json to claude-code or copilot.`);
  const found = await adapter.detect();
  if (!found.ok) throw new CliError(`${adapter.id} isn't ready: ${found.problem ?? 'unknown problem'} Run \`${BRAND.cli} doctor\`.`);

  const token = await githubToken(env, deps.run);
  // Checks the name too (owner/name, nothing that could change the URL).
  const comments = await recentReviewComments(repo, token, deps.fetch);
  out.log(`Read ${comments.length} review comment${comments.length === 1 ? '' : 's'} from ${repo}.`);
  if (comments.length === 0) {
    out.log('No review comments written by people to learn from, so there is nothing to suggest.');
    return 0;
  }

  out.log(`${adapter.id} is looking for your team's review habits…`);
  const stopping = new AbortController();
  const stop = () => stopping.abort();
  process.once('SIGINT', stop);
  deps.stop?.addEventListener('abort', stop, { once: true });
  const mcp = await startMcpServer({ onError: (err) => out.error(`[mcp] ${err.message}`) });
  // Two private folders (0700): an empty one for the agent to run in (it needs no code), one for its config files with the token.
  const workDir = mkdtempSync(join(tmpdir(), 'nitpilot-rules-'));
  const tmpDir = mkdtempSync(join(tmpdir(), 'nitpilot-'));
  const proposals: string[] = [];
  const job = mcp.registerJob(rulesSuggestTools({ repo, comments, proposals }));
  try {
    // Reviewer mode: the agent can only read (an empty folder) and use these two tools.
    const invocation = adapter.buildInvocation({
      mode: 'reviewer', cwd: workDir, prompt: rulesSuggestPrompt(repo), mcp: { url: job.url, token: job.token }, tmpDir, baseEnv: agentBaseEnv(env), model: config.model, maxTurns: MAX_TURNS,
    });
    let last = '';
    const run = await runAgent(adapter, invocation, {
      cwd: workDir,
      timeoutMs: config.jobTimeoutMinutes * 60_000,
      signal: stopping.signal,
      onEvent: (event) => {
        if (event.type !== 'progress' || event.text === last) return;
        out.log(`  ${event.text}`);
        last = event.text;
      },
    });
    if (!run.outcome.ok) {
      out.error(`Your agent's run failed (${run.outcome.reason}): ${run.stderrTail}`);
      return 1;
    }
  } finally {
    job.unregister();
    process.off('SIGINT', stop);
    deps.stop?.removeEventListener('abort', stop);
    await mcp.close();
    rmSync(workDir, { recursive: true, force: true });
    rmSync(tmpDir, { recursive: true, force: true });
  }

  out.log('');
  if (proposals.length === 0) {
    out.log('Your agent found no habit that comes up often enough to suggest.');
    return 0;
  }
  out.log(`Paste this into .nitpilot.yml on your default branch, and edit it as you like:`);
  out.log('');
  out.log(guidelinesYaml(proposals).trimEnd());
  return 0;
}

/** The `guidelines:` block, quoted wherever YAML needs it. lineWidth 0: one line per guideline, never folded. */
export function guidelinesYaml(guidelines: readonly string[]): string {
  return stringify({ guidelines }, { lineWidth: 0 });
}

/** The GitHub repo the current folder's clone points at. Several remotes (a fork and its upstream): you pick. */
async function repoHere(cwd: string): Promise<string> {
  let clone: string;
  try {
    clone = await gitTopLevel(resolve(cwd));
  } catch (err) {
    throw new CliError(`${(err as Error).message} Or name the repo: ${RULES_USAGE}`);
  }
  const names = await githubReposIn(clone);
  if (names.length === 1) return names[0]!;
  if (names.length === 0) throw new CliError(`This clone has no GitHub remote. ${RULES_USAGE}`);
  throw new CliError(`This clone points at ${names.join(' and ')}. Say which: ${RULES_USAGE}`);
}
