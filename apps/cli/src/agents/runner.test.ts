import { existsSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../test/temp';
import { agentBaseEnv, KILL_GRACE_MS, runAgent } from './runner';
import type { AgentAdapter, AgentEvent, AgentInvocation } from './types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An adapter that understands lines starting with "status:" and "done:", and calls a run good when the last line said done. */
const lines: Pick<AgentAdapter, 'parseLine' | 'outcome'> = {
  parseLine: (line) => (line.startsWith('status:') ? { type: 'progress', text: line.slice(7) } : line.startsWith('done:') ? { type: 'result', ok: true, text: line.slice(5) } : null),
  outcome: ({ code, last }) => (code === 0 && last?.type === 'result' ? { ok: true } : { ok: false, reason: 'crash', retryable: true }),
};

/** An "agent": node running this code, with files written first. */
const node = (code: string, files: AgentInvocation['files'] = []): AgentInvocation => ({ command: process.execPath, args: ['-e', code], env: agentBaseEnv(), files });

describe('runAgent', () => {
  it('writes its files (0600), runs it in its folder, and passes on each line the adapter understands', async () => {
    const dir = tempDir();
    const config = join(tempDir(), 'mcp.json');
    const events: AgentEvent[] = [];
    const code = `const fs = require('fs'); console.log('status:' + fs.readFileSync(${JSON.stringify(config)}, 'utf8') + ' in ' + process.cwd()); console.log('noise'); console.log('done:ok')`;
    const run = await runAgent(lines, node(code, [{ path: config, content: 'secret' }]), { cwd: dir, timeoutMs: 10_000, onEvent: (e) => events.push(e) });
    expect(run.outcome).toEqual({ ok: true });
    expect(events).toEqual([{ type: 'progress', text: expect.stringMatching(new RegExp(`^secret in .*${dir.split('/').at(-1)}$`)) }, { type: 'result', ok: true, text: 'ok' }]);
    expect(statSync(config).mode & 0o777).toBe(0o600);
  });

  it('keeps the end of stderr, and lets the adapter judge a failed run', async () => {
    const run = await runAgent(lines, node('console.error("not logged in"); process.exit(1)'), { cwd: tempDir(), timeoutMs: 10_000 });
    expect(run).toEqual({ outcome: { ok: false, reason: 'crash', retryable: true }, stderrTail: 'not logged in\n' });
  });

  it('kills a hanging agent and everything it started within the timeout plus 5 s, even one that ignores SIGTERM (spec §12.3 L5)', async () => {
    const marker = join(tempDir(), 'child-still-ran');
    // The agent ignores SIGTERM and starts a child that would write the marker after 7 s, then both hang.
    // The child ignores SIGTERM too, and the agent exits by itself after 20 s, so an interrupted run can't leave it forever.
    const child = `process.on('SIGTERM', () => {}); setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 7000)`;
    const agent = node(`process.on('SIGTERM', () => {}); setTimeout(() => process.exit(), 20000); require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore' }); setInterval(() => {}, 1000)`);
    const started = Date.now();
    const run = await runAgent(lines, agent, { cwd: tempDir(), timeoutMs: 300 });
    expect(Date.now() - started).toBeLessThan(300 + KILL_GRACE_MS + 1_000);
    expect(run.outcome).toEqual({ ok: false, reason: 'timeout', retryable: true });
    expect(run.stderrTail).toContain('[stopped after 0 s]');
    await sleep(7_500 - (Date.now() - started));
    expect(existsSync(marker)).toBe(false);
  }, 15_000);

  it('stops what the agent left running when it exits', async () => {
    const marker = join(tempDir(), 'left-behind-ran');
    // The agent starts a child in its group that would write the marker after 1 s, then exits at once.
    const child = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 1000)`;
    const run = await runAgent(lines, node(`require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore' }); console.log('done:ok'); process.exit(0)`), { cwd: tempDir(), timeoutMs: 10_000 });
    expect(run.outcome).toEqual({ ok: true });
    await sleep(1_500);
    expect(existsSync(marker)).toBe(false);
  });

  it('stops the agent when the job is cancelled, and never starts one for a job cancelled already', async () => {
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 200);
    const run = await runAgent(lines, node('setInterval(() => {}, 1000)'), { cwd: tempDir(), timeoutMs: 10_000, signal: stop.signal });
    expect(run.outcome).toEqual({ ok: false, reason: 'crash', retryable: true });
    expect(run.stderrTail).toContain('[stopped: the job was cancelled]');

    const marker = join(tempDir(), 'ran');
    const again = await runAgent(lines, node(`require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`), { cwd: tempDir(), timeoutMs: 10_000, signal: stop.signal });
    expect(again.outcome).toMatchObject({ ok: false });
    expect(existsSync(marker)).toBe(false);
  });

  it("keeps the end of stderr on a whole character, even when the cut lands inside one", async () => {
    const run = await runAgent(lines, node(`process.stderr.write('é'.repeat(3000) + '!END\\n'); process.exitCode = 1`), { cwd: tempDir(), timeoutMs: 10_000 });
    expect(run.stderrTail.startsWith('\uFFFD')).toBe(false);
    expect(run.stderrTail.endsWith('!END\n')).toBe(true);
    expect(Buffer.byteLength(run.stderrTail)).toBeLessThanOrEqual(4096);
  });

  it('never times out an agent that has ended, while a program it left holds its output', async () => {
    // The agent starts a detached program that holds stdout for 3 s, then ends at once: the run is done, only the output is still open.
    const holder = `setTimeout(() => {}, 3000)`;
    const code = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(holder)}], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] }); console.log('done:ok'); process.exit(0)`;
    const started = Date.now();
    const run = await runAgent(lines, node(code), { cwd: tempDir(), timeoutMs: 400 });
    expect(run.outcome).toEqual({ ok: true });
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(run.stderrTail).not.toContain('[stopped');
  });

  it('never writes its files through a link that is already there', async () => {
    const dir = tempDir();
    const target = join(dir, 'target');
    const link = join(dir, 'mcp.json');
    writeFileSync(target, 'original');
    symlinkSync(target, link);
    await expect(runAgent(lines, node('console.log("done:ok")', [{ path: link, content: 'secret' }]), { cwd: dir, timeoutMs: 10_000 })).rejects.toThrow(/EEXIST/);
    expect(readFileSync(target, 'utf8')).toBe('original');
  });

  it("says so when the agent's program doesn't exist", async () => {
    const run = await runAgent(lines, { command: 'no-such-agent-nitpilot', args: [], env: agentBaseEnv(), files: [] }, { cwd: tempDir(), timeoutMs: 10_000 });
    expect(run).toEqual({ outcome: { ok: false, reason: 'crash', retryable: false }, stderrTail: "Couldn't start no-such-agent-nitpilot: spawn no-such-agent-nitpilot ENOENT" });
  });
});

describe('agentBaseEnv', () => {
  it('passes only an allowlist: no tokens or keys reach an agent (spec §12.3 S3)', () => {
    const env = agentBaseEnv({ PATH: '/bin', HOME: '/home/maya', LANG: 'el_GR.UTF-8', GITHUB_TOKEN: 'ghp_x', GH_TOKEN: 'x', NPM_TOKEN: 'x', AWS_SECRET_ACCESS_KEY: 'x', ANTHROPIC_API_KEY: 'sk-ant-x', NITPILOT_TOKEN: 'nit_x' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/maya', LANG: 'el_GR.UTF-8' });
  });

  it('keeps where Claude Code keeps its login, and how you reach the network: none of them is a secret', () => {
    const mine = {
      CLAUDE_CONFIG_DIR: '/home/maya/.claude-work', HTTPS_PROXY: 'http://proxy:3128', HTTP_PROXY: 'http://proxy:3128', NO_PROXY: 'localhost',
      https_proxy: 'http://proxy:3128', http_proxy: 'http://proxy:3128', no_proxy: 'localhost', NODE_EXTRA_CA_CERTS: '/etc/ssl/company.pem',
    };
    expect(agentBaseEnv({ PATH: '/bin', ...mine, GITHUB_TOKEN: 'ghp_x' })).toEqual({ PATH: '/bin', ...mine });
  });
});
