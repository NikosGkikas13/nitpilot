import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { BRAND } from '@nitpilot/protocol';
import { CLI_VERSION } from '../version';
import { JobTokens, newJobToken } from './tokens';
import { ToolError, type McpTool } from './tool';

/** Where one job's agent connects, and how to take the job's tools away again. */
export type JobRegistration = { url: string; token: string; unregister(): void };

export type LocalMcpServer = {
  port: number;
  /** Give a job its own token and tools. The agent sends the token as `Authorization: Bearer <token>`. */
  registerJob(tools: readonly McpTool[]): JobRegistration;
  close(): Promise<void>;
};

const MCP_PATH = '/mcp';

/**
 * The daemon's local MCP server (spec §11): one per daemon, on 127.0.0.1 and a random free port.
 * Every request must come from this machine (Host and Origin checked, against DNS rebinding) and carry
 * a job's token, which picks the tools it may call. Errors the agent can't see (the SDK's own, and
 * unexpected tool failures) go to `onError`. See docs/why/local-mcp-server.md.
 */
export async function startMcpServer(options: { onError?: (err: Error) => void } = {}): Promise<LocalMcpServer> {
  const onError = options.onError ?? (() => {});
  const jobs = new JobTokens<readonly McpTool[]>();
  // The SDK builds a fresh MCP server for every request, from the tools of the job whose token came with it.
  const mcp = createMcpHandler(({ authInfo }) => toolServer((authInfo?.extra?.tools as readonly McpTool[] | undefined) ?? [], onError), {
    onerror: onError,
  });
  const serveMcp = toNodeHandler(mcp, { onerror: onError });
  const checkHost = localhostHostValidation();
  const checkOrigin = localhostOriginValidation();

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!checkHost(req, res) || !checkOrigin(req, res)) return; // already answered 403
    if (req.url !== MCP_PATH) return refuse(res, 404, 'Not found.');
    const tools = jobs.find(req.headers.authorization);
    if (!tools) return refuse(res, 401, 'Missing or unknown token.');
    // `auth` is how the SDK's Node adapter hands verified credentials to the factory above.
    void serveMcp(Object.assign(req, { auth: { token: 'verified', clientId: BRAND.cli, scopes: [], extra: { tools } } }), res);
  });
  await new Promise<void>((listening) => http.listen(0, '127.0.0.1', listening));
  const { port } = http.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}${MCP_PATH}`;

  return {
    port,
    registerJob(tools) {
      const token = newJobToken();
      jobs.add(token, tools);
      return { url, token, unregister: () => jobs.remove(token) };
    },
    async close() {
      await mcp.close();
      http.closeAllConnections();
      await new Promise<void>((closed) => http.close(() => closed()));
    },
  };
}

function refuse(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: message }));
}

/** An MCP server with exactly these tools. */
function toolServer(tools: readonly McpTool[], onError: (err: Error) => void): McpServer {
  const server = new McpServer({ name: BRAND.mcpServerName, version: CLI_VERSION });
  for (const tool of tools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input }, (args) => answer(tool, args, onError));
  }
  return server;
}

/** Run a tool. Whatever goes wrong goes back to the agent as a tool error it can read, never as a crash of the server. */
async function answer(tool: McpTool, args: unknown, onError: (err: Error) => void): Promise<CallToolResult> {
  try {
    const value = await tool.run(args);
    return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
  } catch (err) {
    if (err instanceof ToolError) return { isError: true, content: [{ type: 'text', text: err.message }] };
    // Not the agent's mistake: tell the daemon's log, and give the agent a message it can read.
    onError(err instanceof Error ? err : new Error(String(err)));
    const message = `${tool.name} failed: ${err instanceof Error ? err.message : String(err)}`;
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
}
