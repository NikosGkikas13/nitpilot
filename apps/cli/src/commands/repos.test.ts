import { execFile } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { recordOut } from '../../test/out';
import { tempDir } from '../../test/temp';
import { loadConfigFile, saveConfig } from '../config/config';
import { reposAdd } from './repos';

const run = promisify(execFile);

/** A new git clone with these remotes. realpath: macOS's temp folder is a symlink, and git reports the real path. */
async function cloneWith(remotes: Record<string, string>): Promise<string> {
  const dir = realpathSync(tempDir());
  await run('git', ['-C', dir, 'init', '-q']);
  for (const [name, url] of Object.entries(remotes)) await run('git', ['-C', dir, 'remote', 'add', name, url]);
  return dir;
}

describe('nitpilot repos add', () => {
  it('links the clone to every GitHub repo its remotes point at', async () => {
    const clone = await cloneWith({ origin: 'git@github.com:maya/shop-api.git', upstream: 'https://github.com/acme/shop-api.git' });
    const dir = tempDir();
    const out = recordOut();
    await reposAdd(clone, { env: { NITPILOT_CONFIG_DIR: dir }, out });
    expect(loadConfigFile(dir).repos).toEqual({ 'maya/shop-api': { path: clone }, 'acme/shop-api': { path: clone } });
    expect(out.lines).toContain(`Linked acme/shop-api → ${clone}`);
  });

  it("works from a folder inside the clone, and keeps the repo's setup and checks", async () => {
    const clone = await cloneWith({ origin: 'https://github.com/acme/shop-api.git' });
    mkdirSync(join(clone, 'src'));
    const dir = tempDir();
    saveConfig({ ...loadConfigFile(dir), repos: { 'acme/shop-api': { path: '/old/place', setup: ['npm', 'ci'] } } }, dir);
    await reposAdd(join(clone, 'src'), { env: { NITPILOT_CONFIG_DIR: dir }, out: recordOut() });
    expect(loadConfigFile(dir).repos['acme/shop-api']).toEqual({ path: clone, setup: ['npm', 'ci'] });
  });

  it('explains when the folder is not a git clone', async () => {
    await expect(reposAdd(tempDir(), { env: { NITPILOT_CONFIG_DIR: tempDir() }, out: recordOut() })).rejects.toThrow('is not inside a git clone');
  });

  it('explains when no remote is on GitHub', async () => {
    const clone = await cloneWith({ origin: 'git@gitlab.com:acme/shop-api.git' });
    await expect(reposAdd(clone, { env: { NITPILOT_CONFIG_DIR: tempDir() }, out: recordOut() })).rejects.toThrow('has no GitHub remote');
  });
});
