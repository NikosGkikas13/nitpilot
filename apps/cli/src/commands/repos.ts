import { resolve } from 'node:path';
import { BRAND } from '@nitpilot/protocol';
import { configDir, loadConfigFile, saveConfig } from '../config/config';
import { CliError } from '../errors';
import { gitTopLevel, githubReposIn } from '../git/remotes';
import { terminal, type Out } from '../out';

export type ReposDeps = { env?: Record<string, string | undefined>; out?: Out };

/**
 * `nitpilot repos add [path]` (spec §11): link a local clone to the GitHub repos its remotes point at,
 * so jobs for them can come to this device. Keeps any `setup` and `checks` already configured.
 */
export async function reposAdd(path: string | undefined, deps: ReposDeps = {}): Promise<void> {
  const out = deps.out ?? terminal;
  const dir = configDir(deps.env ?? process.env);
  const clone = await gitTopLevel(resolve(path ?? '.'));
  const names = await githubReposIn(clone);
  if (names.length === 0) throw new CliError(`${clone} has no GitHub remote. Add one (git remote add origin <url>) and try again.`);

  const cfg = loadConfigFile(dir);
  for (const name of names) {
    cfg.repos[name] = { ...cfg.repos[name], path: clone };
    out.log(`Linked ${name} → ${clone}`);
  }
  saveConfig(cfg, dir);
  out.log(`A running \`${BRAND.cli} start\` picks this up when you restart it.`);
}
