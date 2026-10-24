import type { AgentJobType } from '@nitpilot/protocol';
import { describe, expect, it, onTestFinished } from 'vitest';
import { prRepo } from '../../test/git-fixtures';
import { connectAgent, jsonOf, textOf } from '../../test/mcp-agent';
import { mcpJob } from '../../test/mcp-job';
import { jobTools } from './job-tools';
import { startMcpServer } from './server';
import { toolsFor } from './tool-sets';

async function mcpServer() {
  const server = await startMcpServer();
  onTestFinished(() => server.close());
  return server;
}

describe('jobTools', () => {
  it('gives each job type exactly its tools over MCP, each bound to its own job', async () => {
    const server = await mcpServer();
    const pr = prRepo();
    for (const type of ['review', 're_review', 'address'] satisfies AgentJobType[]) {
      const ctx = await mcpJob(pr, { type, jobId: `job_${type}`, sinceSha: type === 're_review' ? pr.baseSha : null });
      const job = server.registerJob(jobTools(ctx));
      const agent = await connectAgent(job.url, job.token);
      expect((await agent.listTools()).tools.map((t) => t.name)).toEqual(toolsFor(type));
      expect(jsonOf<{ type: AgentJobType }>(await agent.callTool({ name: 'get_job', arguments: {} })).type).toBe(type);
    }
  });

  it("lets a reviewer's agent read the PR and raise a point, all kept in the job's buffer", async () => {
    const server = await mcpServer();
    const ctx = await mcpJob(prRepo());
    const job = server.registerJob(jobTools(ctx));
    const agent = await connectAgent(job.url, job.token);
    const { files } = jsonOf<{ files: { path: string }[] }>(await agent.callTool({ name: 'list_changed_files', arguments: {} }));
    expect(files.map((f) => f.path)).toEqual(['src/orders.ts']);
    expect(textOf(await agent.callTool({ name: 'get_diff', arguments: { path: 'src/orders.ts' } }))).toContain('+export const pageSize = 50;');
    const added = await agent.callTool({ name: 'add_point', arguments: { path: 'src/orders.ts', line: 1, severity: 'minor', category: 'style', title: 'Page size', body: 'Use 25.' } });
    expect(jsonOf(added)).toEqual({ ref: 'N1' });
    expect(textOf(await agent.callTool({ name: 'finish', arguments: { summary: 'One nit.' } }))).toBe('Summary saved. You can stop now.');
    expect(ctx.buffer.toJobResult(null)).toMatchObject({ summary: 'One nit.', points: [{ path: 'src/orders.ts', title: 'Page size' }] });
  });

  it('refuses bad arguments as tool errors: a body over 4,000 characters, a since that is not a sha', async () => {
    const server = await mcpServer();
    const ctx = await mcpJob(prRepo());
    const job = server.registerJob(jobTools(ctx));
    const agent = await connectAgent(job.url, job.token);
    const long = await agent.callTool({ name: 'add_point', arguments: { severity: 'nit', category: 'docs', title: 'Long', body: 'x'.repeat(4001) } });
    expect(long).toMatchObject({ isError: true });
    const option = await agent.callTool({ name: 'list_changed_files', arguments: { since: '--output=/tmp/pwned' } });
    expect(option).toMatchObject({ isError: true });
    expect(textOf(option)).toContain('a full 40-character commit sha');
    expect(ctx.buffer.isEmpty()).toBe(true);
  });

  it("runs an address job's checks over MCP", async () => {
    const server = await mcpServer();
    const base = await mcpJob(prRepo(), { type: 'address', you: { login: 'maya', githubId: '7', role: 'author' } });
    const ctx = { ...base, checks: { test: [process.execPath, '-e', 'console.log("4 passed")'] } };
    const job = server.registerJob(jobTools(ctx));
    const agent = await connectAgent(job.url, job.token);
    expect(jsonOf(await agent.callTool({ name: 'run_check', arguments: { name: 'test' } }))).toEqual({ ok: true, exitCode: 0, outputTail: '4 passed\n' });
  });
});
