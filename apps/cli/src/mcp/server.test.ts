import { onTestFinished, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connectAgent, jsonOf, rawPost, textOf } from '../../test/mcp-agent';
import { startMcpServer } from './server';
import { defineTool, ToolError } from './tool';

async function mcpServer(options?: Parameters<typeof startMcpServer>[0]) {
  const server = await startMcpServer(options);
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
    // The SDK refuses a tool outside the job's set as a protocol error (a rejected call), not as a tool result.
    await expect(agentA.callTool({ name: 'only_b', arguments: {} })).rejects.toThrow('Tool only_b not found');
  });

  it("sends a tool's mistakes back as tool errors the agent can read", async () => {
    const server = await mcpServer();
    const job = server.registerJob([
      defineTool({ name: 'pick', description: 'Pick a number.', input: z.object({ n: z.number().int() }), run: async ({ n }) => {
        if (n > 3) throw new ToolError('Pick 1, 2 or 3.');
        if (n === 0) throw new Error('disk on fire');
        if (n === -1) throw 'no disk';
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
    expect(textOf(await agent.callTool({ name: 'pick', arguments: { n: -1 } }))).toBe('pick failed: no disk');
    const wrongType = await agent.callTool({ name: 'pick', arguments: { n: 'two' } });
    expect(wrongType).toMatchObject({ isError: true });
    expect(textOf(wrongType)).toContain('expected number');
  });

  it('reports an error the agent cannot see, a factory that throws, to onError', async () => {
    const errors: Error[] = [];
    const server = await mcpServer({ onError: (err) => errors.push(err) });
    const twice = server.registerJob([whoAmI('A'), whoAmI('A')]);
    await connectAgent(twice.url, twice.token).then((agent) => agent.listTools()).then(
      () => expect.unreachable('a job with two tools of the same name should not work'),
      () => undefined,
    );
    expect(errors.map((e) => e.message)).toEqual(['Tool who_am_i is already registered']);
  });

  it('reports an unexpected tool failure to onError, but not a ToolError (the agent\'s own mistake)', async () => {
    const errors: Error[] = [];
    const server = await mcpServer({ onError: (err) => errors.push(err) });
    const broken = new Error('disk on fire');
    const job = server.registerJob([
      defineTool({ name: 'breaks', description: 'Breaks.', input: z.object({}), run: async () => { throw broken; } }),
      defineTool({ name: 'refuses', description: 'Refuses.', input: z.object({}), run: async () => { throw new ToolError('Not like that.'); } }),
    ]);
    const agent = await connectAgent(job.url, job.token);
    expect(textOf(await agent.callTool({ name: 'refuses', arguments: {} }))).toBe('Not like that.');
    expect(errors).toEqual([]);
    expect(textOf(await agent.callTool({ name: 'breaks', arguments: {} }))).toBe('breaks failed: disk on fire');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(broken);
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
