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
  | { exit: number }
  | { rules_review: { max_points: number } }
  | { rules_address: true }
  | { rules_re_review: true };

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

// The playground's rules (playground.json): instead of a fixed list, the agent reads the PR and reacts to it,
// so the public demo tells the same believable story on any seeded branch. Simple text rules, never a real
// review. Each rule has its own category, and the author and re-reviewer go by that category:
//   bug (an `i <= arr.length` loop) and style (a leftover console.log): fixed by editing the line, then resolved;
//   other (a TODO or FIXME): answered, then resolved;
//   tests (a new function with no test file in the PR): declined, then kept open, so the engine escalates it to a human.

type Finding = { path: string; line: number; side: 'RIGHT'; severity: string; category: string; title: string; body: string };
type ChangedFile = { path: string; status: string; binary: boolean; ignored: boolean };
type Job = { type: keyof Scenario; you: { login: string }; points: JobPoint[] };
type JobPoint = { number: number; origin: string; raisedBy: string; path: string | null; line: number | null; category: string; status: string; authorResolution: string | null; trusted: boolean };

const isTestFile = (path: string) => /\.(test|spec)\.[a-z]+$/.test(path);
const baseName = (path: string) => path.split('/').at(-1)!.replace(/\..*$/, '');

/** The lines a unified diff adds, with their line numbers in the new file. */
function addedLines(diff: string): { line: number; text: string }[] {
  const added: { line: number; text: string }[] = [];
  let next = 0;
  for (const row of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(row);
    if (hunk) next = Number(hunk[1]);
    else if (next === 0 || row.startsWith('+++') || row.startsWith('\\')) continue;
    else if (row.startsWith('+')) added.push({ line: next++, text: row.slice(1) });
    else if (!row.startsWith('-')) next++;
  }
  return added;
}

/** What the rules find on one added line. A new function only counts once per review (`testsRaised`). */
function rulesFor(path: string, text: string, hasTest: boolean, testsRaised: boolean): Omit<Finding, 'path' | 'line' | 'side'>[] {
  const found: Omit<Finding, 'path' | 'line' | 'side'>[] = [];
  const fn = /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)|^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/.exec(text);
  if (fn && !hasTest && !testsRaised) {
    const name = fn[1] ?? fn[2];
    found.push({ severity: 'minor', category: 'tests', title: `\`${name}\` has no test`, body: `This PR adds \`${name}\` but no test file for ${baseName(path)}. A small test would pin down what it should return.` });
  }
  if (/\bfor\s*\(.*<=\s*[\w.]+\.length/.test(text)) {
    found.push({ severity: 'major', category: 'bug', title: 'Off-by-one: the loop runs one step past the end', body: 'With `<=`, the last turn reads one item past the end of the array, which is `undefined`. Use `<`.' });
  }
  if (/\bconsole\.log\(/.test(text)) {
    found.push({ severity: 'minor', category: 'style', title: 'Leftover `console.log`', body: 'This looks like debugging output. Remove it before merging.' });
  }
  if (/\b(TODO|FIXME)\b/.test(text)) {
    found.push({ severity: 'nit', category: 'other', title: 'A TODO is left in the code', body: 'Is this meant to ship as is? If the work is planned, link the issue; if not, remove the note.' });
  }
  return found;
}

async function rulesReview(maxPoints: number): Promise<void> {
  const { files } = JSON.parse(await call('list_changed_files')) as { files: ChangedFile[] };
  const tests = files.filter((f) => isTestFile(f.path)).map((f) => baseName(f.path));
  const findings: Finding[] = [];
  for (const file of files) {
    if (file.binary || file.ignored || file.status === 'deleted') continue;
    const hasTest = isTestFile(file.path) || tests.includes(baseName(file.path));
    for (const { line, text } of addedLines(await call('get_diff', { path: file.path }))) {
      const testsRaised = findings.some((f) => f.category === 'tests');
      for (const rule of rulesFor(file.path, text, hasTest, testsRaised)) findings.push({ path: file.path, line, side: 'RIGHT', ...rule });
    }
  }
  const raised = findings.slice(0, maxPoints);
  for (const finding of raised) await call('add_point', finding);
  await call('finish', { summary: raised.length > 0 ? `Raised ${raised.length} point${raised.length === 1 ? '' : 's'} from a first read of the diff.` : 'Nothing to raise: the diff looks clean.' });
}

/** The author: fix the bug and style points in the files, answer the TODO, decline the missing test. */
async function rulesAddress(job: Job): Promise<void> {
  const open = job.points.filter((p) => p.origin === 'agent' && p.trusted && p.status === 'open');
  // Bottom of each file first, so deleting a line doesn't move the lines of the points still to fix.
  const fixes = open.filter((p) => (p.category === 'bug' || p.category === 'style') && p.path && p.line).sort((a, b) => b.line! - a.line!);
  for (const point of fixes) {
    const file = inFolder(point.path!);
    const lines = readFileSync(file, 'utf8').split('\n');
    const i = point.line! - 1;
    if (point.category === 'style') lines.splice(i, 1);
    else lines[i] = lines[i]!.replace('<=', '<');
    writeFileSync(file, lines.join('\n'));
    say({ type: 'progress', text: `edited ${point.path}` });
  }
  for (const point of open) {
    if (point.category === 'bug') await call('reply_to_point', { point: point.number, resolution: 'fixed', comment: 'Good catch: now `<`.' });
    else if (point.category === 'style') await call('reply_to_point', { point: point.number, resolution: 'fixed', comment: 'Removed.' });
    else if (point.category === 'other') await call('reply_to_point', { point: point.number, resolution: 'answered', comment: 'It is tracked in an issue and out of scope for this PR.' });
    else if (point.category === 'tests') await call('reply_to_point', { point: point.number, resolution: 'declined', comment: "It's a small helper and the end-to-end tests already cover it, so a unit test would only repeat them." });
  }
  await call('finish', { summary: open.length > 0 ? 'Fixed what was quick, answered the TODO, and pushed back on the extra test.' : 'Nothing open to answer.' });
}

/** The re-reviewer: accept the fixes and the answer, keep the declined test open (the engine then asks a human). */
async function rulesReReview(job: Job): Promise<void> {
  const mine = job.points.filter((p) => p.origin === 'agent' && p.raisedBy === job.you.login && p.status === 'addressed');
  for (const point of mine) {
    if (point.authorResolution === 'declined') await call('decide_point', { point: point.number, decision: 'keep_open', comment: 'I still think a short test is worth it here. Leaving this one for a human.' });
    else await call('decide_point', { point: point.number, decision: 'resolve', comment: point.authorResolution === 'fixed' ? 'Fixed, thanks.' : 'Fair enough.' });
  }
  const kept = mine.filter((p) => p.authorResolution === 'declined').length;
  await call('finish', { summary: kept > 0 ? `Settled ${mine.length - kept}; ${kept} needs a human.` : `Settled ${mine.length}.` });
}

try {
  const job = JSON.parse(await call('get_job')) as Job;
  for (const step of scenario[job.type] ?? []) {
    if ('add_point' in step) await call('add_point', step.add_point);
    else if ('decide' in step) await call('decide_point', step.decide);
    else if ('reply' in step) await call('reply_to_point', step.reply);
    else if ('run_check' in step) await call('run_check', { name: step.run_check });
    else if ('finish' in step) await call('finish', { summary: step.finish });
    else if ('sleep' in step) await sleep(step.sleep);
    else if ('exit' in step) process.exit(step.exit);
    else if ('rules_review' in step) await rulesReview(step.rules_review.max_points);
    else if ('rules_address' in step) await rulesAddress(job);
    else if ('rules_re_review' in step) await rulesReReview(job);
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
