import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CliError } from '../errors';

const run = promisify(execFile);

/**
 * `owner/name` for a GitHub remote URL, or null for anything else. Understands https, ssh:// and the
 * short `git@host:owner/name.git` form. Over SSH the host may also be an alias from `~/.ssh/config`, used
 * to run two GitHub accounts on one machine (spec §17): one without a dot (`github-a`, `github-b`) or one
 * that starts with `github.com-` (`github.com-work`).
 */
export function parseGithubRemote(url: string): string | null {
  const path = githubPath(url.trim());
  const m = path ? /^\/?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(path) : null;
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The path part of a remote URL (`owner/name.git`) when its host is GitHub, else null. */
function githubPath(url: string): string | null {
  const short = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)(.+)$/.exec(url); // git@github.com:owner/name.git
  if (short) return isGithubHost(short[1]!, { sshAlias: true }) ? short[2]! : null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null; // a local path, for example
  }
  if (parsed.protocol === 'ssh:') return isGithubHost(parsed.hostname, { sshAlias: true }) ? parsed.pathname : null;
  if (['https:', 'http:', 'git:'].includes(parsed.protocol)) return isGithubHost(parsed.hostname, { sshAlias: false }) ? parsed.pathname : null;
  return null;
}

function isGithubHost(host: string, opts: { sshAlias: boolean }): boolean {
  return host === 'github.com' || (opts.sshAlias && (!host.includes('.') || host.startsWith('github.com-')));
}

/** The top folder of the git clone that contains `path`. */
export async function gitTopLevel(path: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', path, 'rev-parse', '--show-toplevel']);
    return stdout.trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new CliError('git is not installed (or not on your PATH).');
    throw new CliError(`${path} is not inside a git clone. Run this in a clone, or pass the clone's path.`);
  }
}

/** The GitHub repos a clone's remotes point at (origin, upstream, …), each listed once. */
export async function githubReposIn(clone: string): Promise<string[]> {
  const { stdout } = await run('git', ['-C', clone, 'remote', '-v']);
  return githubReposInRemoteList(stdout);
}

/** The GitHub repos in `git remote -v` output, each listed once. */
export function githubReposInRemoteList(text: string): string[] {
  // Each line looks like: origin<TAB>git@github.com:octo/sandbox.git (fetch)
  const names = text
    .split('\n')
    .map((line) => line.split(/\s+/)[1])
    .filter((url): url is string => Boolean(url))
    .map((url) => parseGithubRemote(url))
    .filter((name): name is string => name !== null);
  return [...new Set(names)];
}
