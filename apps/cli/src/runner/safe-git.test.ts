import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANARY_HOOK, prRepo } from '../../test/git-fixtures';
import { tempDir } from '../../test/temp';
import { emptyHooksDir, linkedGitDir, safeGit, safeGitArgs, safeGitEnv, SafeGitError, type GitPlace } from './safe-git';

/** The person's clone of a PR repo, and a linked worktree of it at the PR's head, made with safeGit. */
async function worktreeOf(pr: ReturnType<typeof prRepo>) {
  const clone: GitPlace = { gitDir: join(pr.clone, '.git'), hooksDir: emptyHooksDir(tempDir()), env: pr.env };
  await safeGit(clone, ['fetch', '-q', pr.base, pr.bundle.git.fetchRef]);
  const dir = join(pr.root, 'worktree');
  await safeGit(clone, ['worktree', 'add', '--detach', dir, pr.headSha]);
  const inTree: GitPlace = { ...clone, gitDir: linkedGitDir(dir), workTree: dir };
  return { clone, dir, inTree };
}

describe('safeGitArgs and safeGitEnv', () => {
  const place: GitPlace = { gitDir: '/code/shop-api/.git/worktrees/w', workTree: '/tmp/w', hooksDir: '/cfg/no-hooks' };

  it('puts the four safety settings before every command', () => {
    expect(safeGitArgs(place, ['status'])).toEqual([
      '-c', 'core.hooksPath=/cfg/no-hooks',
      '-c', 'core.symlinks=false',
      '-c', 'core.fsmonitor=false',
      '-c', 'submodule.recurse=false',
      'status',
    ]);
  });

  it('passes only allowlisted variables, names the place, and never prompts', () => {
    const env = safeGitEnv({
      ...place,
      env: { PATH: '/usr/bin', HOME: '/home/maya', SSH_AUTH_SOCK: '/tmp/ssh', GITHUB_TOKEN: 'ghp_x', AWS_SECRET_ACCESS_KEY: 'x', GIT_INDEX_FILE: '/elsewhere' },
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/maya',
      SSH_AUTH_SOCK: '/tmp/ssh',
      GIT_DIR: '/code/shop-api/.git/worktrees/w',
      GIT_WORK_TREE: '/tmp/w',
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
    });
  });

  it('keeps your own GIT_SSH_COMMAND', () => {
    expect(safeGitEnv({ ...place, env: { GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work' } }).GIT_SSH_COMMAND).toBe('ssh -i ~/.ssh/work');
  });
});

describe('safeGit', () => {
  it("never runs the repo's hooks, even through a relative core.hooksPath in its config", async () => {
    const hooks = { '.husky/post-checkout': CANARY_HOOK, '.husky/pre-commit': CANARY_HOOK, '.husky/post-commit': CANARY_HOOK, '.husky/reference-transaction': CANARY_HOOK };
    const pr = prRepo({ head: hooks });
    pr.git(pr.clone, 'config', 'core.hooksPath', '.husky'); // what `husky install` leaves in a clone
    const { dir, inTree } = await worktreeOf(pr);
    writeFileSync(join(dir, 'README.md'), 'changed\n');
    await safeGit(inTree, ['commit', '-q', '-am', 'change']);
    expect(existsSync(join(pr.home, 'hook-ran'))).toBe(false);

    // The trap is real: plain git in the same worktree runs the PR's hook.
    pr.git(dir, 'commit', '-q', '--allow-empty', '-m', 'plain git');
    expect(existsSync(join(pr.home, 'hook-ran'))).toBe(true);
  });

  it('checks a symlink out as a plain file holding the link text', async () => {
    const pr = prRepo({ head: { 'secret-link': { symlink: '/etc/passwd' } } });
    const { dir } = await worktreeOf(pr);
    expect(lstatSync(join(dir, 'secret-link')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dir, 'secret-link'), 'utf8')).toBe('/etc/passwd');
  });

  it("refuses a worktree whose .git link was changed, and the person's own clone", async () => {
    const pr = prRepo();
    const { clone, dir, inTree } = await worktreeOf(pr);
    writeFileSync(join(dir, '.git'), 'gitdir: /tmp/elsewhere\n');
    await expect(safeGit(inTree, ['status'])).rejects.toThrow(/\.git was changed/);

    rmSync(join(dir, '.git'));
    mkdirSync(join(dir, '.git'));
    await expect(safeGit(inTree, ['status'])).rejects.toThrow(/\.git was changed/);

    await expect(safeGit({ ...clone, workTree: pr.clone }, ['status'])).rejects.toThrow(/\.git was changed/);
  });

  it('passes ; and $(…) through as plain text, never to a shell', async () => {
    const pr = prRepo();
    const { inTree } = await worktreeOf(pr);
    const message = 'fix; touch "$HOME/injected" $(touch "$HOME/injected-too")';
    await safeGit(inTree, ['commit', '-q', '--allow-empty', '-m', message]);
    expect((await safeGit(inTree, ['log', '-1', '--format=%s'])).stdout.trim()).toBe(message);
    expect(existsSync(join(pr.home, 'injected'))).toBe(false);
    expect(existsSync(join(pr.home, 'injected-too'))).toBe(false);
  });

  it("rejects with git's exit code and message when a command fails", async () => {
    const pr = prRepo();
    const { inTree } = await worktreeOf(pr);
    const failed = await safeGit(inTree, ['rev-parse', '--verify', 'no-such-branch']).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(SafeGitError);
    expect(failed).toMatchObject({ code: 128, message: 'git rev-parse failed: fatal: Needed a single revision' });
  });

  it('stops git when the job is cancelled', async () => {
    const pr = prRepo();
    const { inTree } = await worktreeOf(pr);
    await expect(safeGit({ ...inTree, signal: AbortSignal.abort() }, ['status'])).rejects.toThrow('git status was stopped');
  });
});

describe('emptyHooksDir', () => {
  it('gives an empty folder inside the config dir, emptying it if something was put there', () => {
    const configDir = tempDir();
    const dir = emptyHooksDir(configDir);
    expect(dir).toBe(join(configDir, 'no-hooks'));
    writeFileSync(join(dir, 'pre-commit'), '#!/bin/sh\n');
    expect(emptyHooksDir(configDir)).toBe(dir);
    expect(existsSync(join(dir, 'pre-commit'))).toBe(false);
  });
});
