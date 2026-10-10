import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { JobBundle } from '@nitpilot/protocol';
import { jobBundle } from '@nitpilot/protocol/test-samples';
import { tempDir } from './temp';

/** What one file in a test commit holds: text, a symlink, or an executable script (a hook). */
export type FileSpec = string | { symlink: string } | { script: string };

/** A hook that leaves a mark when it runs: `hook-ran` in the sandbox's HOME. */
export const CANARY_HOOK: FileSpec = { script: '#!/bin/sh\ntouch "$HOME/hook-ran"\n' };

/**
 * Git for tests, cut off from the developer's own git setup: its own HOME (a fixed identity, no
 * commit signing, no global hooks) and no system config. Everything lives in one temp folder that is
 * deleted when the test ends. Call it inside a test.
 */
export function gitSandbox() {
  const root = tempDir();
  const home = join(root, 'home');
  mkdirSync(home);
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Maya Test\n\temail = maya@example.com\n[init]\n\tdefaultBranch = main\n');
  const env: Record<string, string | undefined> = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1' };

  /** Plain git, for setting the scene and checking the result (never for the code under test). Trimmed stdout. */
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

  function write(dir: string, files: Record<string, FileSpec>): void {
    for (const [path, spec] of Object.entries(files)) {
      const file = join(dir, path);
      mkdirSync(dirname(file), { recursive: true });
      if (typeof spec === 'string') writeFileSync(file, spec);
      else if ('symlink' in spec) symlinkSync(spec.symlink, file);
      else {
        writeFileSync(file, spec.script);
        chmodSync(file, 0o755);
      }
    }
  }

  /** Commit these files on top of HEAD in a working folder, and return the new commit's sha. */
  function commit(dir: string, files: Record<string, FileSpec>, message = 'change'): string {
    write(dir, files);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '--no-verify', '-m', message);
    return git(dir, 'rev-parse', 'HEAD');
  }

  return { root, home, env, git, write, commit };
}

/**
 * A pull request the way GitHub stores it, built from local folders:
 * - `base`: the GitHub repo (bare), with `main` and the PR's head at `refs/pull/142/head`; for a
 *   same-repo PR (`fork: false`, the default) also on the PR's branch, `feature/cursor-pagination`;
 * - `clone`: the person's own clone of it, the folder `nitpilot repos add` linked;
 * - `work`: where the PR's author made the commits;
 * - `bundle`: the sample job bundle, pointed at all of it.
 * The base commit has README.md and CLAUDE.md ("Use tabs."); `head` files are committed on top.
 */
export function prRepo(opts: { base?: Record<string, FileSpec>; head?: Record<string, FileSpec>; fork?: boolean } = {}) {
  const box = gitSandbox();
  const sample = jobBundle();
  const base = join(box.root, 'base.git');
  box.git(box.root, 'init', '-q', '--bare', base);
  const work = join(box.root, 'work');
  box.git(box.root, 'init', '-q', work);
  const baseSha = box.commit(work, { 'README.md': 'Shop API\n', 'CLAUDE.md': 'Use tabs.\n', ...opts.base }, 'base');
  box.git(work, 'push', '-q', base, 'HEAD:refs/heads/main');
  const headSha = box.commit(work, { 'src/orders.ts': 'export const pageSize = 50;\n', ...opts.head }, 'cursor pagination');
  box.git(work, 'push', '-q', base, `HEAD:${sample.git.fetchRef}`);
  if (!opts.fork) box.git(work, 'push', '-q', base, `HEAD:refs/heads/${sample.git.headBranch}`);
  const clone = join(box.root, 'clone');
  box.git(box.root, 'clone', '-q', base, clone);

  const bundle: JobBundle = { ...sample, pr: { ...sample.pr, baseSha, headSha }, git: { ...sample.git, baseCloneUrl: base } };

  /** Someone else pushes to the PR's branch (Review Focus #2). Returns the new head. */
  function pushAsHuman(files: Record<string, FileSpec>): string {
    const sha = box.commit(work, files, 'a human pushed');
    box.git(work, 'push', '-q', base, `HEAD:refs/heads/${sample.git.headBranch}`);
    return sha;
  }

  return { ...box, base, clone, work, baseSha, headSha, bundle, pushAsHuman };
}
