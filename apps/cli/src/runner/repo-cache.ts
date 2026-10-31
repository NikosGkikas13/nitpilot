import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BRAND } from '@nitpilot/protocol';
import type { PersonalConfig } from '../config/config';
import { CliError } from '../errors';
import { isFolderName } from './worktree';

/**
 * The clone a one-off review (`nitpilot review`) checks the PR out from: your linked clone when this repo has one,
 * else an empty repo of our own at <config dir>/cache/<owner>/<name>. It needs nothing in it: prepareWorktree
 * fetches the PR's head and base into it from GitHub on every run, so only what a review needs is ever downloaded.
 */
export async function reviewRepoPath(
  repoFullName: string,
  opts: { config: Pick<PersonalConfig, 'repos'>; configDir: string; env?: Record<string, string | undefined> },
): Promise<string> {
  const linked = Object.hasOwn(opts.config.repos, repoFullName) ? opts.config.repos[repoFullName] : undefined;
  if (linked) return linked.path;

  // The name becomes folders, so `../..` must never get this far (parsePrRef lets dots through).
  const parts = repoFullName.split('/');
  if (parts.length !== 2 || !parts.every(isFolderName)) throw new CliError(`${repoFullName} isn't a GitHub repo name (owner/name).`);
  const dir = join(opts.configDir, 'cache', ...parts);
  if (existsSync(join(dir, '.git'))) return dir;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    await promisify(execFile)('git', ['init', '--quiet', '--', dir], { env: opts.env as NodeJS.ProcessEnv | undefined });
  } catch (err) {
    throw new CliError(`Couldn't set up ${dir} for the review (is git installed? \`${BRAND.cli} doctor\` checks): ${(err as Error).message}`);
  }
  return dir;
}
