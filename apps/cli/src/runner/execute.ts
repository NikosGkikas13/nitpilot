import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobResult, NewPoint } from '@nitpilot/protocol';
import { jobPrompt } from '../agents/prompt';
import { agentBaseEnv, runAgent } from '../agents/runner';
import type { AgentAdapter, AgentMode } from '../agents/types';
import type { PersonalConfig } from '../config/config';
import type { JobExecutor, JobIo, JobOutcome } from '../daemon';
import type { McpJobContext } from '../mcp/context';
import { ResultBuffer } from '../mcp/buffer';
import { jobTools } from '../mcp/job-tools';
import type { JobRegistration, LocalMcpServer } from '../mcp/server';
import { diffBaseSha, listChangedFiles } from '../mcp/tools/read';
import { checkEnv, CHECK_TIMEOUT_MS, runInWorktree } from '../mcp/tools/run-check';
import { JobFailure } from './job-failure';
import { commitAndPush, pushTarget } from './push';
import { emptyHooksDir } from './safe-git';
import { scrubPathsFor } from './scrub';
import { snippetFor } from './snippets';
import { prepareWorktree, type Worktree } from './worktree';

/** How many turns an agent gets for one job. Plenty for a review; a runaway agent stops here or at the job's timeout. */
export const MAX_TURNS = 50;

export type ExecutorDeps = {
  config: PersonalConfig;
  configDir: string;
  mcp: Pick<LocalMcpServer, 'registerJob'>;
  adapter: AgentAdapter;
  /** Where git, the setup command and the agent take their (allowlisted) variables from. Default: this process's. */
  env?: Record<string, string | undefined>;
};

/**
 * The job executor (spec §11 steps 1–8): check the PR out, run the repo's setup (address jobs), give the
 * job its tools and token, run the agent, commit and push (address jobs), attach snippets, and answer.
 * The worktree is always removed afterwards. See docs/why/git-worktrees.md and docs/why/local-mcp-server.md.
 */
export function createExecutor(deps: ExecutorDeps): JobExecutor {
  const { config, configDir, adapter } = deps;
  const env = deps.env ?? process.env;
  // Every agent's files go, not only this agent's: a PR's .env or AGENTS.md has no business in a job (spec §11 step 3).
  const scrubPaths = scrubPathsFor(adapter.scrubPaths);
  return async (bundle, io) => {
    const repo = Object.hasOwn(config.repos, bundle.pr.repoFullName) ? config.repos[bundle.pr.repoFullName]! : null;
    if (!repo) return { kind: 'reject', reason: 'repo_not_linked' };
    const mode: AgentMode = bundle.type === 'address' ? 'editor' : 'reviewer';
    if (!adapter.modes.includes(mode)) return { kind: 'reject', reason: 'unsupported_mode' };

    let worktree: Worktree | null = null;
    try {
      io.progress('preparing', 'Checking out the PR');
      worktree = await prepareWorktree(bundle, repo.path, { configDir, hooksDir: emptyHooksDir(configDir), scrubPaths, signal: io.signal, env });
      // Where fixes will go, asked before the agent runs: a deleted fork or a missing remote fails now, not after the work.
      const remote = bundle.type === 'address' && bundle.apply === 'auto' ? await pushTarget(bundle, worktree.git) : null;
      if (bundle.type === 'address' && repo.setup) await runSetup(repo.setup, worktree, env, io.signal);

      const ctx: McpJobContext = { bundle, worktree, buffer: new ResultBuffer(), checks: repo.checks ?? {} };
      const failure = await runAgentFor(ctx, mode, io, deps, env);
      if (failure) return failure;
      if (ctx.buffer.isEmpty()) return { kind: 'fail', reason: 'no_result', retryable: true, detail: 'The agent finished without using any Nitpilot tool.' };

      let push = null;
      if (bundle.type === 'address') {
        io.progress('pushing', bundle.apply === 'auto' ? 'Committing and pushing the fixes' : 'Committing the fixes as a draft');
        // A draft never pushes, so it has no remote (null); an auto job always has one, from pushTarget above.
        ({ push } = await commitAndPush({ bundle, worktree, remote, scrubPaths, pushing: io.pushing }));
      }
      io.progress('finishing', 'Sending the result');
      return { kind: 'complete', result: await withSnippets(ctx, ctx.buffer.toJobResult(push)) };
    } catch (err) {
      // A JobFailure is an answer in the protocol's words. Anything else is a bug: the daemon reports it as a crash.
      if (err instanceof JobFailure) return { kind: 'fail', reason: err.reason, retryable: err.retryable, detail: err.message };
      throw err;
    } finally {
      await worktree?.cleanup();
    }
  };
}

/** The repo's `setup` command (spec §11 step 4): the CLI runs it, not the agent, with the same short environment as a check. */
async function runSetup(argv: readonly string[], worktree: Worktree, env: Record<string, string | undefined>, signal: AbortSignal): Promise<void> {
  const result = await runInWorktree(argv, { cwd: worktree.dir, env: checkEnv(env), timeoutMs: CHECK_TIMEOUT_MS, signal });
  if (!result.ok) throw new JobFailure('setup_failed', true, `The repo's setup command (${argv.join(' ')}) failed:\n${result.outputTail}`);
}

/** Give the job its tools and token, run the agent, and take them away again. Null when the agent's run went fine. */
async function runAgentFor(ctx: McpJobContext, mode: AgentMode, io: JobIo, deps: ExecutorDeps, env: Record<string, string | undefined>): Promise<JobOutcome | null> {
  // A folder only you can open (mkdtemp makes it 0700) for the agent's config files, which hold the token.
  const tmpDir = mkdtempSync(join(tmpdir(), 'nitpilot-'));
  let job: JobRegistration | null = null;
  try {
    job = deps.mcp.registerJob(jobTools(ctx));
    const invocation = deps.adapter.buildInvocation({
      mode, cwd: ctx.worktree.dir, prompt: jobPrompt(ctx.bundle), mcp: { url: job.url, token: job.token }, tmpDir, baseEnv: agentBaseEnv(env), maxTurns: MAX_TURNS,
    });
    io.progress('running_agent', `Running ${deps.adapter.id}`);
    const run = await runAgent(deps.adapter, invocation, {
      cwd: ctx.worktree.dir,
      timeoutMs: deps.config.jobTimeoutMinutes * 60_000,
      signal: io.signal,
      onEvent: (event) => {
        if (event.type === 'progress') io.progress('running_agent', event.text);
      },
    });
    if (run.outcome.ok) return null;
    return { kind: 'fail', reason: run.outcome.reason, retryable: run.outcome.retryable, detail: run.stderrTail };
  } finally {
    // The token stops working the moment the agent is done (spec §11), and its files go with the folder.
    job?.unregister();
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Attach the code around each point on a line (spec §11 step 7): the head for a RIGHT point, the merge-base
 * for a LEFT one, where a renamed file still has its old name.
 */
async function withSnippets(ctx: McpJobContext, result: JobResult): Promise<JobResult> {
  const hasLeft = result.points.some((p) => p.side === 'LEFT');
  const base = hasLeft ? await diffBaseSha(ctx) : null;
  const oldPaths = new Map(hasLeft ? (await listChangedFiles(ctx)).files.map((f) => [f.path, f.oldPath ?? f.path]) : []);
  const points = await Promise.all(
    result.points.map(async (point): Promise<NewPoint> => {
      if (point.path === null || point.line === null) return point;
      const left = point.side === 'LEFT';
      const sha = left ? base! : ctx.worktree.headSha;
      const path = left ? (oldPaths.get(point.path) ?? point.path) : point.path;
      return { ...point, snippet: await snippetFor(ctx.worktree.git, sha, path, point.line) };
    }),
  );
  return { ...result, points };
}
