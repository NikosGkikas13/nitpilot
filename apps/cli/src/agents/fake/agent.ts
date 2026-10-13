// The fake agent (spec §12.2): a stand-in for Claude Code or Gemini CLI in tests and CI. It reads its MCP
// config file, connects to the job's tools exactly like a real agent, and does what its scenario file
// says for the job's type. Each step prints one JSON line; the last says how it went.
//   node --experimental-strip-types agent.ts --mcp-config <file> --scenario <file>
// It runs as its own process with Node's type stripping, so it imports packages only, never ./files.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

type Step =
  | { add_point: Record<string, unknown> }
  | { decide: { point: number; decision: string; comment: string } }
  | { reply: { point: number; resolution: string; comment: string } }
  | { edit: { path: string; content: string } }
  | { run_check: string }
  | { finish: string }
  | { sleep: number }
  | { exit: number };

/** What to do for each job type. A type that isn't listed does nothing (and so writes nothing). */
type Scenario = { review?: Step[]; re_review?: Step[]; address?: Step[] };

const say = (event: object) => process.stdout.write(`${JSON.stringify(event)}\n`);

const { values } = parseArgs({ options: { 'mcp-config': { type: 'string' }, scenario: { type: 'string' } } });
const { url, token } = JSON.parse(readFileSync(values['mcp-config']!, 'utf8')) as { url: string; token: string };
const scenario = JSON.parse(readFileSync(values.scenario!, 'utf8')) as Scenario;

const client = new Client({ name: 'nitpilot-fake-agent', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));

/** Call a tool and return its text. A tool error ends the run: a scenario that hits one is wrong. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  say({ type: 'progress', text: `calling ${name}` });
  const result = await client.callTool({ name, arguments: args });
  const [first] = (result.content ?? []) as { type: string; text?: string }[];
  const text = first?.type === 'text' ? (first.text ?? '') : '';
  if (result.isError) throw new Error(`${name}: ${text}`);
  return text;
}

/** A file in the agent's folder, never outside it. */
function inFolder(path: string): string {
  const full = resolve(path);
  if (!full.startsWith(process.cwd() + sep)) throw new Error(`${path} is outside the agent's folder`);
  return full;
}

try {
  const job = JSON.parse(await call('get_job')) as { type: keyof Scenario };
  for (const step of scenario[job.type] ?? []) {
    if ('add_point' in step) await call('add_point', step.add_point);
    else if ('decide' in step) await call('decide_point', step.decide);
    else if ('reply' in step) await call('reply_to_point', step.reply);
    else if ('run_check' in step) await call('run_check', { name: step.run_check });
    else if ('finish' in step) await call('finish', { summary: step.finish });
    else if ('sleep' in step) await sleep(step.sleep);
    else if ('exit' in step) process.exit(step.exit);
    else if ('edit' in step) {
      const file = inFolder(step.edit.path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, step.edit.content);
      say({ type: 'progress', text: `edited ${step.edit.path}` });
    }
  }
  say({ type: 'result', ok: true, text: `followed the ${job.type} scenario` });
} catch (err) {
  say({ type: 'result', ok: false, text: (err as Error).message });
  process.exitCode = 1;
} finally {
  await client.close();
}
