import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { prRepo } from '../../../test/git-fixtures';
import { mcpJob } from '../../../test/mcp-job';
import { tempDir } from '../../../test/temp';
import { jobTools } from '../../mcp/job-tools';
import { startMcpServer } from '../../mcp/server';
import { getAdapter } from '../registry';
import { agentBaseEnv, runAgent } from '../runner';
import { FAKE_SCENARIOS, fakeAdapter } from './adapter';

/** Run the fake agent on a review job of a test PR, the way the executor will. */
async function runFake(scenario: string) {
  const mcp = await startMcpServer();
  onTestFinished(() => mcp.close());
  const ctx = await mcpJob(prRepo());
  const job = mcp.registerJob(jobTools(ctx));
  const adapter = fakeAdapter({ scenario: join(FAKE_SCENARIOS, scenario) });
  const invocation = adapter.buildInvocation({ mode: 'reviewer', cwd: ctx.worktree.dir, prompt: 'Review this PR.', mcp: job, tmpDir: tempDir(), baseEnv: agentBaseEnv(), maxTurns: 10 });
  const run = await runAgent(adapter, invocation, { cwd: ctx.worktree.dir, timeoutMs: 30_000 });
  return { ctx, job, invocation, run };
}

describe('the fake agent', () => {
  it('follows its scenario over real MCP, and the token never shows on its command line', async () => {
    const { ctx, job, invocation, run } = await runFake('happy.json');
    expect(run.outcome).toEqual({ ok: true });
    expect(ctx.buffer.toJobResult(null)).toMatchObject({
      summary: 'Two points: the page size, and the README.',
      points: [{ path: 'src/orders.ts', line: 1, title: 'Page size is too big' }, { path: null, title: 'Mention the new page size in the README' }],
    });
    expect(invocation.args.join(' ')).not.toContain(job.token);
  });

  it('writes nothing when its scenario has nothing for the job, which the executor reports as no_result', async () => {
    const { ctx, run } = await runFake('silent.json');
    expect(run.outcome).toEqual({ ok: true });
    expect(ctx.buffer.isEmpty()).toBe(true);
  });

  it('counts a crash as one', async () => {
    const { run } = await runFake('crash.json');
    expect(run.outcome).toEqual({ ok: false, reason: 'crash', retryable: true });
  });
});

describe('getAdapter', () => {
  it('has the fake agent and Claude Code; Gemini CLI waits for Task 20', async () => {
    expect(getAdapter('fake')?.id).toBe('fake');
    expect(await getAdapter('fake')!.detect()).toMatchObject({ ok: true });
    expect(getAdapter('claude-code')?.id).toBe('claude-code');
    expect(getAdapter('gemini-cli')).toBeNull();
  });
});
