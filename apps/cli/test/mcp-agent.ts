import { request } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { onTestFinished } from 'vitest';

/** An MCP client that connects the way an agent does: the job's URL, its token as a bearer header. Closed when the test ends. */
export async function connectAgent(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  onTestFinished(() => client.close());
  return client;
}

/** The text of a tool's answer (tools answer with one text block). */
export function textOf(result: { content?: unknown }): string {
  const [first] = (result.content ?? []) as { type: string; text?: string }[];
  return first?.type === 'text' ? (first.text ?? '') : '';
}

/** A tool's answer, parsed: tools that return an object send it as JSON text. */
export function jsonOf<T = unknown>(result: { content?: unknown }): T {
  return JSON.parse(textOf(result)) as T;
}

/** A raw POST with any headers (fetch won't let a test forge `Host`). Resolves with the status code. */
export function rawPost(url: string, headers: Record<string, string>, body = '{}'): Promise<number> {
  return new Promise((done, fail) => {
    const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on('error', fail);
    req.end(body);
  });
}
