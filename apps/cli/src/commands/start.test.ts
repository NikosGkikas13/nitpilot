import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { prRepo } from '../../test/git-fixtures';
import { recordOut } from '../../test/out';
import { startStubHub } from '../../test/stub-hub';
import { tempDir } from '../../test/temp';
import { fakeAdapter } from '../agents/fake/adapter';
import type { AgentAdapter } from '../agents/types';
import { PersonalConfigSchema, saveConfig } from '../config/config';
import { CLI_VERSION } from '../version';
import { start } from './start';

const TOKEN = 'nit_test';

/** `nitpilot start` against a stub server, with this agent. Stopped (and awaited) when the test ends. */
async function started(adapter: AgentAdapter | null, repos: Record<string, { path: string }> = {}) {
  const hub = await startStubHub({ token: TOKEN });
  const dir = tempDir();
  saveConfig(PersonalConfigSchema.parse({ server: hub.url, token: TOKEN, agent: 'fake', repos }), dir);
  // A worktree a crash left behind.
  mkdirSync(join(dir, 'worktrees', 'acme', 'shop-api', '142-reviewer-job_0-1'), { recursive: true });
  const out = recordOut();
  const stop = new AbortController();
  const exit = start({ env: { NITPILOT_CONFIG_DIR: dir, PATH: process.env.PATH, HOME: process.env.HOME }, out, stop: stop.signal, adapter });
  onTestFinished(async () => {
    stop.abort();
    await exit.catch(() => {});
    await hub.close();
  });
  const conn = await hub.connection(5_000);
  const hello = await conn.next('hello');
  return { dir, out, stop, exit, hello };
}

describe('nitpilot start', () => {
  it('asks you to log in first', async () => {
    await expect(start({ env: { NITPILOT_CONFIG_DIR: tempDir() }, out: recordOut() })).rejects.toThrow('Not logged in. Run `nitpilot login` first.');
  });

  it('cleans up what a crash left, says hello with what its agent can do, and stops cleanly', async () => {
    const { dir, stop, exit, hello } = await started(fakeAdapter());
    expect(hello.d.agent).toEqual({ id: 'fake', version: CLI_VERSION, modes: ['reviewer', 'editor'] });
    expect(existsSync(join(dir, 'worktrees'))).toBe(false);
    stop.abort();
    expect(await exit).toBe(0);
  });

  it('removes draft refs older than 14 days from every linked clone before taking jobs, and a broken clone stops nothing', async () => {
    const pr = prRepo();
    const date = new Date(Date.now() - 15 * 24 * 60 * 60_000).toISOString();
    const old = execFileSync('git', ['commit-tree', `${pr.headSha}^{tree}`, '-p', pr.headSha, '-m', 'an old draft'], { cwd: pr.clone, env: { ...pr.env, GIT_COMMITTER_DATE: date }, encoding: 'utf8' }).trim();
    pr.git(pr.clone, 'update-ref', 'refs/nitpilot/drafts/job_old', old);
    pr.git(pr.clone, 'update-ref', 'refs/nitpilot/drafts/job_new', pr.headSha); // committed today
    const { out } = await started(fakeAdapter(), { 'acme/shop-api': { path: pr.clone }, 'acme/gone': { path: join(pr.root, 'no-such-clone') } });
    expect(pr.git(pr.clone, 'for-each-ref', '--format=%(refname)', 'refs/nitpilot')).toBe('refs/nitpilot/drafts/job_new');
    expect(out.text()).toContain('Removed 1 draft older than 14 days.');
  });

  it('stops at once when it is told to stop before it starts', { timeout: 5_000 }, async () => {
    const hub = await startStubHub({ token: TOKEN });
    onTestFinished(() => hub.close());
    const dir = tempDir();
    saveConfig(PersonalConfigSchema.parse({ server: hub.url, token: TOKEN, agent: 'fake' }), dir);
    const stop = new AbortController();
    stop.abort();
    const exit = await start({ env: { NITPILOT_CONFIG_DIR: dir, PATH: process.env.PATH, HOME: process.env.HOME }, out: recordOut(), stop: stop.signal, adapter: fakeAdapter() });
    expect(exit).toBe(0);
  });

  it("takes no jobs when its agent isn't wired in yet, and says so", async () => {
    const { out, hello } = await started(null);
    expect(hello.d.agent.modes).toEqual([]);
    expect(out.text()).toContain("fake isn't wired in yet: this device shows notifications, but takes no jobs.");
  });
});
