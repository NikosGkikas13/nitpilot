import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { prRepo } from '../../test/git-fixtures';
import { tempDir } from '../../test/temp';
import { CliError } from '../errors';
import { reviewRepoPath } from './repo-cache';
import { emptyHooksDir } from './safe-git';
import { SCRUB_PATHS } from './scrub';
import { prepareWorktree } from './worktree';

const noRepos = { repos: {} };

describe('reviewRepoPath', () => {
  it("uses your linked clone when the repo has one", async () => {
    const configDir = tempDir();
    const config = { repos: { 'acme/shop-api': { path: '/code/shop-api' } } };
    expect(await reviewRepoPath('acme/shop-api', { config, configDir })).toBe('/code/shop-api');
    expect(existsSync(join(configDir, 'cache'))).toBe(false);
  });

  it('otherwise makes an empty repo in the cache that a review can check the PR out from, and reuses it', async () => {
    const pr = prRepo();
    const configDir = tempDir();
    const path = await reviewRepoPath('acme/shop-api', { config: noRepos, configDir, env: pr.env });
    expect(path).toBe(join(configDir, 'cache', 'acme', 'shop-api'));

    // Nothing was cloned up front: prepareWorktree fetches the PR into it (from baseCloneUrl, since it has no remote).
    const wt = await prepareWorktree(pr.bundle, path, { configDir, hooksDir: emptyHooksDir(configDir), scrubPaths: SCRUB_PATHS, env: pr.env });
    onTestFinished(() => wt.cleanup());
    expect(wt.headSha).toBe(pr.headSha);
    expect(readFileSync(join(wt.dir, 'src/orders.ts'), 'utf8')).toBe('export const pageSize = 50;\n');

    expect(await reviewRepoPath('acme/shop-api', { config: noRepos, configDir, env: pr.env })).toBe(path);
  });

  it('refuses a name that would reach outside the cache, and makes nothing', async () => {
    const configDir = tempDir();
    for (const name of ['../..', 'acme/..', 'acme', 'acme/shop/api', 'acme/shop api']) {
      await expect(reviewRepoPath(name, { config: noRepos, configDir }), name).rejects.toThrow(CliError);
    }
    expect(existsSync(join(configDir, 'cache'))).toBe(false);
  });
});
