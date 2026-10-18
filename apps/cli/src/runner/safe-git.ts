import { execFile, type ExecFileException } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Where a git command runs. Every command names its git directory (GIT_DIR), and its worktree
 * (GIT_WORK_TREE) when it needs files, so git never goes looking for a repo on its own (spec §11).
 */
export type GitPlace = {
  /** The clone's git directory, or a linked worktree's own (<clone>/.git/worktrees/<name>). */
  gitDir: string;
  /**
   * The linked worktree to work in. Left out for commands that only touch refs and objects (fetch,
   * worktree add): those run with `--bare`, so git never treats the git directory itself as a worktree.
   */
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
    /** Git printed more than the output limit (see SafeGitOptions.maxOutputBytes); stdout holds only what fit. */
    readonly outputTooLarge: boolean = false,
  ) {
    super(message);
    this.name = 'SafeGitError';
  }
}

/** The only variables git gets from our environment: enough to find programs, the person's git config and SSH keys. */
const ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'XDG_CONFIG_HOME', 'GIT_CONFIG_NOSYSTEM',
  'SSH_AUTH_SOCK', 'GIT_SSH_COMMAND', 'GIT_SSH', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy',
];

export type SafeGitOptions = {
  /** The most git may print (bytes). Past it, git is stopped and the call rejects with `outputTooLarge`. Default: MAX_OUTPUT_BYTES. */
  maxOutputBytes?: number;
};

/** A slow fetch of a big repo is fine; a git that hangs forever is not. */
const GIT_TIMEOUT_MS = 10 * 60_000;
/** `git show` of a big file or `git ls-files` of a big repo can print a lot. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** The arguments git gets: the four safety settings first, then `--bare` if there's no worktree, then the command. */
export function safeGitArgs(place: GitPlace, args: string[]): string[] {
  return [
    '-c', `core.hooksPath=${place.hooksDir}`, // no hook runs: not the repo's, not husky's, not one a relative path points at
    '-c', 'core.symlinks=false', // a symlink in the PR checks out as a small text file, never a link to your secrets
    '-c', 'core.fsmonitor=false', // fsmonitor would start a program named in the config
    '-c', 'submodule.recurse=false', // never reach into other repos
    // With GIT_DIR set and no GIT_WORK_TREE, git would treat the git folder itself as the worktree
    // (`checkout` would write files into `.git`). `--bare` makes it refuse worktree commands instead.
    ...(place.workTree ? [] : ['--bare']),
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
  // Never wait for a password: fail instead. (ssh gets the same rule in safeGit, see sshCommandWithBatchMode.)
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

/**
 * Run git on PR code (spec §11 "Safe git"): `execFile`, no shell, the four safety settings, an
 * allowlisted environment. It first checks the folder still exists and, in a worktree, that the
 * worktree's `.git` link wasn't changed. Resolves with the output; rejects with SafeGitError when
 * git fails. See docs/why/safe-git.md.
 */
export async function safeGit(place: GitPlace, args: string[], opts: SafeGitOptions = {}): Promise<GitResult> {
  const folder = place.workTree ?? place.gitDir;
  if (!existsSync(folder)) {
    // Without this, git's "can't start in a folder that isn't there" reads as "git is not installed", or as a tampered `.git`.
    throw new SafeGitError(`${folder} doesn't exist (moved or deleted?)`, args, null, '', '');
  }
  if (place.workTree && linkedGitDirOrNull(place.workTree) !== resolve(place.gitDir)) {
    // An agent that can edit files could repoint `.git`. GIT_DIR keeps git from following it anyway,
    // but a changed link means something tried, so stop. A real clone (a `.git` folder) is never a worktree here.
    const message = `${join(place.workTree, '.git')} was changed: refusing to run git there`;
    throw new SafeGitError(message, args, null, '', '');
  }
  const env = safeGitEnv(place);
  if (env.GIT_SSH_COMMAND === undefined && env.GIT_SSH === undefined) env.GIT_SSH_COMMAND = await sshCommandWithBatchMode(place, env, args);
  return runGit(place, args, env, args, opts.maxOutputBytes ?? MAX_OUTPUT_BYTES);
}

/**
 * Respects the person's own key setup (`core.sshCommand`, e.g. `ssh -i ~/.ssh/id_work`) and still
 * stops ssh from ever waiting for a passphrase: their command, plus `-o BatchMode=yes`.
 */
async function sshCommandWithBatchMode(place: GitPlace, env: Record<string, string>, asked: string[]): Promise<string> {
  const configured = await runGit(place, ['config', '--get', 'core.sshCommand'], env, asked, MAX_OUTPUT_BYTES).then(
    (result) => result.stdout.trim(),
    (err: unknown) => {
      if (err instanceof SafeGitError && err.code === 1) return ''; // exit code 1: core.sshCommand isn't set
      throw err;
    },
  );
  return `${configured || 'ssh'} -o BatchMode=yes`;
}

/** Start git. `asked` is the command the caller wanted, so a failure in a helper command is reported under that name. */
function runGit(place: GitPlace, gitArgs: string[], env: Record<string, string>, asked: string[], maxBuffer: number): Promise<GitResult> {
  const options = { cwd: place.workTree ?? place.gitDir, env, signal: place.signal, timeout: GIT_TIMEOUT_MS, maxBuffer };
  return new Promise((done, fail) => {
    execFile('git', safeGitArgs(place, gitArgs), options, (err, stdout, stderr) => {
      if (!err) return done({ stdout, stderr });
      const code = typeof err.code === 'number' ? err.code : null;
      const outputTooLarge = err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
      fail(new SafeGitError(describeFailure(asked, err, stderr, maxBuffer), asked, code, stdout, stderr, outputTooLarge));
    });
  });
}

function describeFailure(args: string[], err: ExecFileException, stderr: string, maxBuffer: number): string {
  const command = `git ${args[0] ?? ''}`.trim();
  if (err.name === 'AbortError') return `${command} was stopped`;
  if (err.code === 'ENOENT') return 'git is not installed (or not on your PATH)';
  if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return `${command} printed more than ${maxBuffer} bytes`;
  if (err.killed) return `${command} took longer than ${GIT_TIMEOUT_MS / 60_000} minutes`;
  // Git's own error line, not the lines around it (a rejected push prints `To <url>` and ` ! [rejected]` first).
  const lines = stderr.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const why = lines.find((line) => line.startsWith('fatal:') || line.startsWith('error:')) ?? lines[0];
  return `${command} failed: ${why ?? `exit code ${String(err.code)}`}`;
}

/**
 * The git directory a linked worktree's `.git` file names ("gitdir: …"). Throws when `.git` is
 * missing, a folder (a real clone, never a worktree we made), a symlink, or anything but that one line.
 */
export function linkedGitDir(workTree: string): string {
  const link = join(workTree, '.git');
  if (!lstatSync(link).isFile()) throw new Error(`${link} is not a file`);
  // The whole file, not just one line of it: git's own rule is "gitdir: " and then the path.
  const named = /^gitdir: (.+)\n*$/.exec(readFileSync(link, 'utf8'));
  if (!named) throw new Error(`${link} doesn't name a git directory`);
  return resolve(workTree, named[1]!);
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
  // A link (or file) where the folder should be is removed itself: lstat doesn't follow links, and unlink never reaches the link's target.
  const found = lstatOrNull(dir);
  if (found && !found.isDirectory()) unlinkSync(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const entry of readdirSync(dir)) rmSync(join(dir, entry), { recursive: true, force: true });
  return dir;
}

function lstatOrNull(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}
