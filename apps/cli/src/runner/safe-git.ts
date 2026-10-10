import { execFile, type ExecFileException } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Where a git command runs. Every command names its git directory (GIT_DIR), and its worktree
 * (GIT_WORK_TREE) when it needs files, so git never goes looking for a repo on its own (spec §11).
 */
export type GitPlace = {
  /** The clone's git directory, or a linked worktree's own (<clone>/.git/worktrees/<name>). */
  gitDir: string;
  /** The linked worktree to work in. Left out for commands that only touch refs and objects (fetch, worktree add). */
  workTree?: string;
  /** An empty folder for core.hooksPath, so no hook runs (see emptyHooksDir). */
  hooksDir: string;
  /** Stops git when the job is cancelled. */
  signal?: AbortSignal;
  /** Where the allowlisted variables come from. Default: this process's environment. */
  env?: Record<string, string | undefined>;
};

export type GitResult = { stdout: string; stderr: string };

/** Git failed, couldn't start, was stopped, or found its worktree tampered with. */
export class SafeGitError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly code: number | null,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'SafeGitError';
  }
}

/** The only variables git gets from our environment: enough to find programs, the person's git config and SSH keys. */
const ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'XDG_CONFIG_HOME',
  'SSH_AUTH_SOCK', 'GIT_SSH_COMMAND', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy',
];

/** A slow fetch of a big repo is fine; a git that hangs forever is not. */
const GIT_TIMEOUT_MS = 10 * 60_000;
/** `git show` of a big file or `git ls-files` of a big repo can print a lot. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** The arguments git gets: the four safety settings first, then the command. */
export function safeGitArgs(place: GitPlace, args: string[]): string[] {
  return [
    '-c', `core.hooksPath=${place.hooksDir}`, // no hook runs: not the repo's, not husky's, not one a relative path points at
    '-c', 'core.symlinks=false', // a symlink in the PR checks out as a small text file, never a link to your secrets
    '-c', 'core.fsmonitor=false', // fsmonitor would start a program named in the config
    '-c', 'submodule.recurse=false', // never reach into other repos
    ...args,
  ];
}

/** The environment git gets: the allowlist, the place, and no prompts. Tokens and keys in our environment never reach it. */
export function safeGitEnv(place: GitPlace): Record<string, string> {
  const from = place.env ?? process.env;
  const env: Record<string, string> = {};
  for (const name of ENV_ALLOWLIST) {
    const value = from[name];
    if (value !== undefined) env[name] = value;
  }
  env.GIT_DIR = place.gitDir;
  if (place.workTree) env.GIT_WORK_TREE = place.workTree;
  // Never wait for a password: fail instead. SSH gets the same rule unless you set your own GIT_SSH_COMMAND.
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_SSH_COMMAND ??= 'ssh -o BatchMode=yes';
  return env;
}

/**
 * Run git on PR code (spec §11 "Safe git"): `execFile`, no shell, the four safety settings, an
 * allowlisted environment. In a worktree it first checks the worktree's `.git` link wasn't changed.
 * Resolves with the output; rejects with SafeGitError when git fails. See docs/why/safe-git.md.
 */
export function safeGit(place: GitPlace, args: string[]): Promise<GitResult> {
  if (place.workTree && linkedGitDirOrNull(place.workTree) !== resolve(place.gitDir)) {
    // An agent that can edit files could repoint `.git`. GIT_DIR keeps git from following it anyway,
    // but a changed link means something tried, so stop. A real clone (a `.git` folder) is never a worktree here.
    const message = `${join(place.workTree, '.git')} was changed: refusing to run git there`;
    return Promise.reject(new SafeGitError(message, args, null, '', ''));
  }
  const options = { cwd: place.workTree ?? place.gitDir, env: safeGitEnv(place), signal: place.signal, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES };
  return new Promise((done, fail) => {
    execFile('git', safeGitArgs(place, args), options, (err, stdout, stderr) => {
      if (!err) return done({ stdout, stderr });
      const code = typeof err.code === 'number' ? err.code : null;
      fail(new SafeGitError(describeFailure(args, err, stderr), args, code, stdout, stderr));
    });
  });
}

function describeFailure(args: string[], err: ExecFileException, stderr: string): string {
  const command = `git ${args[0] ?? ''}`.trim();
  if (err.name === 'AbortError') return `${command} was stopped`;
  if (err.code === 'ENOENT') return 'git is not installed (or not on your PATH)';
  if (err.killed) return `${command} took longer than ${GIT_TIMEOUT_MS / 60_000} minutes`;
  const why = stderr.split('\n').find((line) => line.trim() !== '');
  return `${command} failed: ${why?.trim() ?? `exit code ${String(err.code)}`}`;
}

/**
 * The git directory a linked worktree's `.git` file names ("gitdir: …"). Throws when `.git` is
 * missing, a folder (a real clone, never a worktree we made) or a symlink.
 */
export function linkedGitDir(workTree: string): string {
  const link = join(workTree, '.git');
  if (!lstatSync(link).isFile()) throw new Error(`${link} is not a file`);
  const named = /^gitdir: (.+)$/m.exec(readFileSync(link, 'utf8'));
  if (!named) throw new Error(`${link} doesn't name a git directory`);
  return resolve(workTree, named[1]!.trim());
}

function linkedGitDirOrNull(workTree: string): string | null {
  try {
    return linkedGitDir(workTree);
  } catch {
    return null;
  }
}

/** <config dir>/no-hooks: the empty folder core.hooksPath points at. Anything found in it is removed first. */
export function emptyHooksDir(configDir: string): string {
  const dir = join(configDir, 'no-hooks');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const entry of readdirSync(dir)) rmSync(join(dir, entry), { recursive: true, force: true });
  return dir;
}
