import { onTestFinished, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connectAgent, jsonOf, rawPost, textOf } from '../../test/mcp-agent';
import { startMcpServer } from './server';
import { defineTool, ToolError } from './tool';

async function mcpServer() {
  const server = await startMcpServer();
  onTestFinished(() => server.close());
  return server;
}

/** A tool that answers with the job's own data, so a test can tell whose tools it reached. */
const whoAmI = (job: string) => defineTool({ name: 'who_am_i', description: 'Which job this is.', input: z.object({}), run: async () => ({ job }) });

const initialize = (protocolVersion: string) =>
  JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name: 'test', version: '1' } } });

describe('startMcpServer', () => {
  it('listens on 127.0.0.1 only, at /mcp', async () => {
    const server = await mcpServer();
    const { url } = server.registerJob([]);
    expect(url).toBe(`http://127.0.0.1:${server.port}/mcp`);
  });

  it('answers 401 without a token, with a wrong one, and once the job is unregistered', async () => {
    const server = await mcpServer();
    const job = server.registerJob([whoAmI('A')]);
    const init = initialize('2025-06-18');
    expect(await rawPost(job.url, {}, init)).toBe(401);
    expect(await rawPost(job.url, { authorization: 'Bearer not-a-token' }, init)).toBe(401);
    expect(await rawPost(job.url, { authorization: `Bearer ${job.token}` }, init)).toBe(200);
    job.unregister();
    expect(await rawPost(job.url, { authorization: `Bearer ${job.token}` }, init)).toBe(401);
  });

  it('answers 403 to a Host or Origin that is not this machine (DNS rebinding), even with a good token', async () => {
    const server = await mcpServer();
    const job = server.registerJob([whoAmI('A')]);
    const auth = { authorization: `Bearer ${job.token}` };
    const init = initialize('2025-06-18');
    expect(await rawPost(job.url, { ...auth, host: 'evil.example' }, init)).toBe(403);
    expect(await rawPost(job.url, { ...auth, host: `attacker.example:${server.port}` }, init)).toBe(403);
    expect(await rawPost(job.url, { ...auth, origin: 'https://evil.example' }, init)).toBe(403);
    expect(await rawPost(job.url, { ...auth, host: `localhost:${server.port}`, origin: `http://localhost:${server.port}` }, init)).toBe(200);
  });

  it('gives two jobs at once only their own tools and data', async () => {
    const server = await mcpServer();
    const a = server.registerJob([whoAmI('A')]);
    const b = server.registerJob([whoAmI('B'), defineTool({ name: 'only_b', description: 'B only.', input: z.object({}), run: async () => 'b' })]);
    const agentA = await connectAgent(a.url, a.token);
    const agentB = await connectAgent(b.url, b.token);
    expect((await agentA.listTools()).tools.map((t) => t.name)).toEqual(['who_am_i']);
    expect((await agentB.listTools()).tools.map((t) => t.name)).toEqual(['who_am_i', 'only_b']);
    expect(jsonOf(await agentA.callTool({ name: 'who_am_i', arguments: {} }))).toEqual({ job: 'A' });
    expect(jsonOf(await agentB.callTool({ name: 'who_am_i', arguments: {} }))).toEqual({ job: 'B' });
    const notYours = await agentA.callTool({ name: 'only_b', arguments: {} }).catch((err: unknown) => ({ isError: true, content: [{ type: 'text', text: String(err) }] }));
    expect(notYours.isError).toBe(true);
  });

  it("sends a tool's mistakes back as tool errors the agent can read", async () => {
    const server = await mcpServer();
    const job = server.registerJob([
      defineTool({ name: 'pick', description: 'Pick a number.', input: z.object({ n: z.number().int() }), run: async ({ n }) => {
        if (n > 3) throw new ToolError('Pick 1, 2 or 3.');
        if (n === 0) throw new Error('disk on fire');
        return `picked ${n}`;
      } }),
    ]);
    const agent = await connectAgent(job.url, job.token);
    expect(textOf(await agent.callTool({ name: 'pick', arguments: { n: 2 } }))).toBe('picked 2');
    const tooBig = await agent.callTool({ name: 'pick', arguments: { n: 9 } });
    expect(tooBig).toMatchObject({ isError: true });
    expect(textOf(tooBig)).toBe('Pick 1, 2 or 3.');
    const broken = await agent.callTool({ name: 'pick', arguments: { n: 0 } });
    expect(textOf(broken)).toBe('pick failed: disk on fire');
    const wrongType = await agent.callTool({ name: 'pick', arguments: { n: 'two' } });
    expect(wrongType).toMatchObject({ isError: true });
    expect(textOf(wrongType)).toContain('expected number');
  });

  it('serves agents that speak the 2025 protocol too', async () => {
    const server = await mcpServer();
    const job = server.registerJob([whoAmI('A')]);
    const res = await fetch(job.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${job.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: initialize('2025-06-18'),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"protocolVersion":"2025-06-18"');
  });
});
