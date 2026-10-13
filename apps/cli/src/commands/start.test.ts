import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
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
async function started(adapter: AgentAdapter | null) {
  const hub = await startStubHub({ token: TOKEN });
  const dir = tempDir();
  saveConfig(PersonalConfigSchema.parse({ server: hub.url, token: TOKEN, agent: 'fake' }), dir);
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

  it("takes no jobs when its agent isn't wired in yet, and says so", async () => {
    const { out, hello } = await started(null);
    expect(hello.d.agent.modes).toEqual([]);
    expect(out.text()).toContain("fake isn't wired in yet: this device shows notifications, but takes no jobs.");
  });
});
