import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prRepo } from '../../../test/git-fixtures';
import { mcpJob } from '../../../test/mcp-job';
import type { McpJobContext } from '../context';
import { ToolError } from '../tool';
import { OUTPUT_TAIL_BYTES, runCheck } from './run-check';

const node = (code: string, ...args: string[]) => [process.execPath, '-e', code, ...args];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withChecks(checks: McpJobContext['checks'], env?: Record<string, string | undefined>): Promise<McpJobContext> {
  const pr = prRepo();
  const ctx = await mcpJob(pr, { type: 'address', you: { login: 'maya', role: 'author' } });
  return { ...ctx, checks, worktree: { ...ctx.worktree, git: { ...ctx.worktree.git, env: env ?? pr.env } } };
}

describe('runCheck', () => {
  it('runs a check from your config in the worktree and reports how it ended', async () => {
    const ctx = await withChecks({ pass: node('console.log(process.cwd())'), fail: node('console.error("2 tests failed"); process.exit(3)') });
    const passed = await runCheck(ctx, { name: 'pass' });
    expect(passed).toMatchObject({ ok: true, exitCode: 0 });
    expect(passed.outputTail.trim()).toMatch(new RegExp(`${ctx.worktree.dir.split('/').at(-1)}$`));
    expect(await runCheck(ctx, { name: 'fail' })).toEqual({ ok: false, exitCode: 3, outputTail: '2 tests failed\n' });
  });

  it("refuses a name that isn't a check, inherited names included", async () => {
    const ctx = await withChecks({ test: node('') });
    for (const name of ['lint', 'constructor', '__proto__']) {
      const err = await runCheck(ctx, { name }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ToolError);
      expect((err as Error).message).toBe(`There's no check called "${name}". You can run: test.`);
    }
    expect(((await runCheck(await withChecks({}), { name: 'test' }).catch((e: unknown) => e)) as Error).message).toBe('No checks are set up for this repo.');
  });

  it('runs no shell: ; and $(…) in an argument are just text', async () => {
    const ctx = await withChecks({ echo: node('console.log(process.argv[1])', 'a; touch pwned $(touch pwned2)') });
    expect((await runCheck(ctx, { name: 'echo' })).outputTail).toBe('a; touch pwned $(touch pwned2)\n');
    expect(existsSync(join(ctx.worktree.dir, 'pwned'))).toBe(false);
    expect(existsSync(join(ctx.worktree.dir, 'pwned2'))).toBe(false);
  });

  it('gives the check no tokens from your environment, and CI=true', async () => {
    const ctx = await withChecks({ env: node('console.log(JSON.stringify(process.env))') }, { PATH: process.env.PATH, HOME: '/home/maya', GITHUB_TOKEN: 'ghp_secret', NPM_TOKEN: 'npm_secret' });
    const env = JSON.parse((await runCheck(ctx, { name: 'env' })).outputTail) as Record<string, string>;
    expect(env).toMatchObject({ HOME: '/home/maya', CI: 'true', NO_COLOR: '1' });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.NPM_TOKEN).toBeUndefined();
  });

  it('stops a check that runs too long, and everything it started', async () => {
    const pr = prRepo();
    const marker = join(pr.home, 'grandchild-finished');
    // The check starts a child of its own that would write the marker after 1.5 s, then hangs.
    const grandchild = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 1500)`;
    const ctx = await withChecks({ hang: node(`require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); setInterval(() => {}, 1000)`) });
    const started = Date.now();
    const result = await runCheck(ctx, { name: 'hang' }, { timeoutMs: 300 });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result).toMatchObject({ ok: false, exitCode: null });
    expect(result.outputTail).toContain('[stopped after 0 s]');
    await sleep(1800);
    expect(existsSync(marker)).toBe(false);
  });

  it('stops waiting for a program the check started in its own session, which keeps the output open', async () => {
    // The grandchild leaves the check's process group (detached) but shares its output pipes; it ends on its own after 4 s.
    const grandchild = `setTimeout(() => {}, 4000)`;
    const ctx = await withChecks({ daemon: node(`require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { detached: true, stdio: 'inherit' }); setInterval(() => {}, 1000)`) });
    const started = Date.now();
    const result = await runCheck(ctx, { name: 'daemon' }, { timeoutMs: 300 });
    expect(Date.now() - started).toBeLessThan(2500);
    expect(result).toMatchObject({ ok: false, exitCode: null });
    expect(result.outputTail).toContain('[stopped after 0 s]');
    expect(result.outputTail).toContain('[stopped waiting: a program the check started still holds its output]');
  }, 8000);

  it('stops a check when the job is cancelled', async () => {
    const stop = new AbortController();
    const base = await withChecks({ hang: node('setInterval(() => {}, 1000)') });
    const ctx = { ...base, worktree: { ...base.worktree, git: { ...base.worktree.git, signal: stop.signal } } };
    setTimeout(() => stop.abort(), 200);
    const result = await runCheck(ctx, { name: 'hang' });
    expect(result).toMatchObject({ ok: false, exitCode: null });
    expect(result.outputTail).toContain('[stopped: the job was cancelled]');
  });

  it('sends back only the last 4 KB of output, and says so when a program is missing', async () => {
    const ctx = await withChecks({ loud: node('for (let i = 0; i < 5000; i++) console.log("noise " + i); console.log("THE END")'), missing: ['no-such-program-nitpilot'] });
    const loud = await runCheck(ctx, { name: 'loud' });
    expect(Buffer.byteLength(loud.outputTail)).toBeLessThanOrEqual(OUTPUT_TAIL_BYTES);
    expect(loud.outputTail.endsWith('noise 4999\nTHE END\n')).toBe(true);
    expect(await runCheck(ctx, { name: 'missing' })).toEqual({ ok: false, exitCode: null, outputTail: "Couldn't start no-such-program-nitpilot: spawn no-such-program-nitpilot ENOENT" });
  });
});
