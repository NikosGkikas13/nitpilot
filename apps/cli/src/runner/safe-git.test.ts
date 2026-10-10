import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANARY_HOOK, prRepo } from '../../test/git-fixtures';
import { tempDir } from '../../test/temp';
import { emptyHooksDir, linkedGitDir, safeGit, safeGitArgs, safeGitEnv, SafeGitError, type GitPlace } from './safe-git';

type PrRepo = ReturnType<typeof prRepo>;

/** The person's clone of a PR repo, as a place with no worktree (for fetch, worktree add, refs). */
function clonePlace(pr: PrRepo): GitPlace {
  return { gitDir: join(pr.clone, '.git'), hooksDir: emptyHooksDir(tempDir()), env: pr.env };
}

/** The person's clone of a PR repo, and a linked worktree of it at the PR's head, made with safeGit. */
async function worktreeOf(pr: PrRepo) {
  const clone = clonePlace(pr);
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

  it('adds --bare when there is no worktree, so git never treats the git folder as one', () => {
    expect(safeGitArgs({ gitDir: '/code/shop-api/.git', hooksDir: '/cfg/no-hooks' }, ['fetch'])).toEqual([
      '-c', 'core.hooksPath=/cfg/no-hooks',
      '-c', 'core.symlinks=false',
      '-c', 'core.fsmonitor=false',
      '-c', 'submodule.recurse=false',
      '--bare',
      'fetch',
    ]);
  });

  it('passes only allowlisted variables, names the place, and never prompts', () => {
    const env = safeGitEnv({
      ...place,
      env: { PATH: '/usr/bin', HOME: '/home/maya', SSH_AUTH_SOCK: '/tmp/ssh', GIT_CONFIG_NOSYSTEM: '1', GITHUB_TOKEN: 'ghp_x', AWS_SECRET_ACCESS_KEY: 'x', GIT_INDEX_FILE: '/elsewhere' },
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/maya',
      SSH_AUTH_SOCK: '/tmp/ssh',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_DIR: '/code/shop-api/.git/worktrees/w',
      GIT_WORK_TREE: '/tmp/w',
      GIT_TERMINAL_PROMPT: '0',
    });
  });

  it('keeps your own GIT_SSH_COMMAND and GIT_SSH', () => {
    expect(safeGitEnv({ ...place, env: { GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work' } }).GIT_SSH_COMMAND).toBe('ssh -i ~/.ssh/work');
    expect(safeGitEnv({ ...place, env: { GIT_SSH: '/usr/local/bin/my-ssh' } }).GIT_SSH).toBe('/usr/local/bin/my-ssh');
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

  it('refuses a .git link with any other line before or after it', async () => {
    const pr = prRepo();
    const { dir, inTree } = await worktreeOf(pr);
    const link = readFileSync(join(dir, '.git'), 'utf8');
    writeFileSync(join(dir, '.git'), `# junk\n${link}`);
    await expect(safeGit(inTree, ['status'])).rejects.toThrow(/\.git was changed/);
    writeFileSync(join(dir, '.git'), `${link}# junk\n`);
    await expect(safeGit(inTree, ['status'])).rejects.toThrow(/\.git was changed/);
  });

  it("says so when the clone's folder is gone", async () => {
    const pr = prRepo();
    const clone = clonePlace(pr);
    rmSync(pr.clone, { recursive: true });
    await expect(safeGit(clone, ['status'])).rejects.toMatchObject({
      name: 'SafeGitError',
      message: `${clone.gitDir} doesn't exist (moved or deleted?)`,
      code: null,
    });
  });

  it("says so when the worktree's folder is gone, instead of blaming its .git link", async () => {
    const pr = prRepo();
    const { dir, inTree } = await worktreeOf(pr);
    rmSync(dir, { recursive: true });
    await expect(safeGit(inTree, ['status'])).rejects.toMatchObject({
      name: 'SafeGitError',
      message: `${dir} doesn't exist (moved or deleted?)`,
      code: null,
    });
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

  it("puts git's error line in the message when a push is rejected, not the line before it", async () => {
    const pr = prRepo();
    const { inTree } = await worktreeOf(pr);
    pr.pushAsHuman({ 'src/orders.ts': 'export const pageSize = 100;\n' });
    const failed = await safeGit(inTree, ['push', pr.base, `HEAD:refs/heads/${pr.bundle.git.headBranch}`]).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(SafeGitError);
    expect((failed as SafeGitError).message).toMatch(/^git push failed: error: failed to push some refs/);
  });

  it('refuses worktree commands in a place with no worktree, instead of using the git folder as one', async () => {
    const pr = prRepo();
    await expect(safeGit(clonePlace(pr), ['checkout', 'HEAD', '--', '.'])).rejects.toThrow(/work tree/);
    expect(existsSync(join(pr.clone, '.git', 'README.md'))).toBe(false);
  });

  it('stops git when the job is cancelled', async () => {
    const pr = prRepo();
    const { inTree } = await worktreeOf(pr);
    await expect(safeGit({ ...inTree, signal: AbortSignal.abort() }, ['status'])).rejects.toThrow('git status was stopped');
  });
});

describe('safeGit and ssh', () => {
  const remote = 'ssh://git@example.invalid/acme/shop-api.git';

  /** Fake ssh programs in a folder: each writes its arguments to `<name>-args` in the sandbox's HOME, then fails. No network. */
  function fakeSsh(pr: PrRepo, ...names: string[]): string {
    const bin = join(pr.root, 'bin');
    pr.write(bin, Object.fromEntries(names.map((name) => [name, { script: `#!/bin/sh\necho "$@" >> "$HOME/${name}-args"\nexit 1\n` }])));
    return bin;
  }
  /** What the fake `name` was called with, or null if it never ran. */
  function calledWith(pr: PrRepo, name: string): string | null {
    const file = join(pr.home, `${name}-args`);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  }

  it('adds BatchMode=yes to ssh, so it never waits for a passphrase', async () => {
    const pr = prRepo();
    const bin = fakeSsh(pr, 'ssh');
    const clone = { ...clonePlace(pr), env: { ...pr.env, PATH: `${bin}:${pr.env.PATH}` } };
    await expect(safeGit(clone, ['fetch', remote])).rejects.toBeInstanceOf(SafeGitError);
    expect(calledWith(pr, 'ssh')).toContain('-o BatchMode=yes');
  });

  it("keeps the clone's own core.sshCommand (two GitHub accounts, two keys) and adds BatchMode=yes to it", async () => {
    const pr = prRepo();
    pr.git(pr.clone, 'config', 'core.sshCommand', 'work-ssh -i /keys/id_work');
    const bin = fakeSsh(pr, 'ssh', 'work-ssh');
    const clone = { ...clonePlace(pr), env: { ...pr.env, PATH: `${bin}:${pr.env.PATH}` } };
    await expect(safeGit(clone, ['fetch', remote])).rejects.toBeInstanceOf(SafeGitError);
    expect(calledWith(pr, 'work-ssh')).toContain('-i /keys/id_work -o BatchMode=yes');
    expect(calledWith(pr, 'ssh')).toBeNull();
  });

  it.each([
    ['GIT_SSH_COMMAND', 'my-ssh -i /keys/id_work'],
    ['GIT_SSH', 'my-ssh'],
  ])('leaves ssh alone when you set %s yourself', async (name, value) => {
    const pr = prRepo();
    const bin = fakeSsh(pr, 'ssh', 'my-ssh');
    const clone = { ...clonePlace(pr), env: { ...pr.env, PATH: `${bin}:${pr.env.PATH}`, [name]: value } };
    await expect(safeGit(clone, ['fetch', remote])).rejects.toBeInstanceOf(SafeGitError);
    expect(calledWith(pr, 'my-ssh')).not.toBeNull();
    expect(calledWith(pr, 'my-ssh')).not.toContain('BatchMode');
    expect(calledWith(pr, 'ssh')).toBeNull();
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

  it('replaces a no-hooks symlink or file with a real folder, without emptying where the link pointed', () => {
    const configDir = tempDir();
    const elsewhere = tempDir();
    writeFileSync(join(elsewhere, 'keep.txt'), 'keep');
    symlinkSync(elsewhere, join(configDir, 'no-hooks'));
    const dir = emptyHooksDir(configDir);
    expect(lstatSync(dir).isDirectory()).toBe(true); // lstat does not follow links: a real folder, not a link to one
    expect(readdirSync(dir)).toEqual([]);
    expect(readFileSync(join(elsewhere, 'keep.txt'), 'utf8')).toBe('keep');

    const otherConfigDir = tempDir();
    writeFileSync(join(otherConfigDir, 'no-hooks'), 'not a folder');
    expect(lstatSync(emptyHooksDir(otherConfigDir)).isDirectory()).toBe(true);
  });
});
