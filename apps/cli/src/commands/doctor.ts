import { statSync } from 'node:fs';
import { BRAND, type AgentId } from '@nitpilot/protocol';
import { adapterFor } from '../agents/registry';
import { loadConfig, type PersonalConfig } from '../config/config';
import { githubReposInRemoteList } from '../git/remotes';
import { ServerClient } from '../http';
import { terminal, type Out } from '../out';
import { runProgram, type RunResult } from '../run-program';

export type Check = { name: string; status: 'ok' | 'warn' | 'fail'; detail: string };
export type AgentCheck = { ok: boolean; version?: string; problem?: string };

/** Everything doctor looks at, so tests can hand it a pretend machine. */
export type DoctorDeps = {
  nodeVersion: string;
  platform: NodeJS.Platform;
  /** Runs a program without a shell, and never throws: a missing program gives code null. */
  run(file: string, args: string[]): Promise<RunResult>;
  loadConfig(): PersonalConfig;
  client(config: PersonalConfig): Pick<ServerClient, 'health' | 'me'>;
  /** Is the agent the config names installed and logged in? */
  detectAgent(config: PersonalConfig): Promise<AgentCheck>;
  isFolder(path: string): boolean;
};

const MIN_NODE = 22;
/** Every program and network check gets 10 s, so a hung one can't hang doctor. */
const CHECK_TIMEOUT_MS = 10_000;

/** `nitpilot doctor` (spec §11, §22): can this machine run jobs? One check per line, in a fixed order. */
export async function runDoctor(deps: DoctorDeps): Promise<Check[]> {
  const checks: Check[] = [checkNode(deps.nodeVersion), checkPlatform(deps.platform), await checkGit(deps)];
  let config: PersonalConfig;
  try {
    config = deps.loadConfig();
  } catch (err) {
    // Without a config there's nothing more to check.
    return [...checks, { name: 'Config', status: 'fail', detail: (err as Error).message }];
  }
  checks.push({ name: 'Config', status: 'ok', detail: 'valid' });

  const client = deps.client(config);
  const server = await checkServer(client, config.server);
  checks.push(server);
  if (server.status === 'ok') checks.push(...(await checkAccount(client, config)));
  checks.push(await checkAgent(deps, config));
  for (const [name, repo] of Object.entries(config.repos)) checks.push(await checkRepo(deps, name, repo.path));
  return checks;
}

function checkNode(version: string): Check {
  const major = Number(version.replace(/^v/, '').split('.')[0]);
  if (major >= MIN_NODE) return { name: 'Node', status: 'ok', detail: version };
  return { name: 'Node', status: 'fail', detail: `${version}: ${BRAND.cli} needs Node ${MIN_NODE} or newer` };
}

function checkPlatform(platform: NodeJS.Platform): Check {
  if (platform === 'win32') return { name: 'Platform', status: 'warn', detail: 'Windows is not supported in v1; use macOS, Linux or WSL' };
  return { name: 'Platform', status: 'ok', detail: platform === 'darwin' ? 'macOS' : platform };
}

async function checkGit(deps: DoctorDeps): Promise<Check> {
  const r = await deps.run('git', ['--version']);
  if (r.code === 0) return { name: 'git', status: 'ok', detail: r.stdout.trim() };
  return { name: 'git', status: 'fail', detail: 'git is not installed (or not on your PATH)' };
}

async function checkServer(client: Pick<ServerClient, 'health'>, server: string): Promise<Check> {
  try {
    const health = await client.health({ signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    return { name: 'Server', status: 'ok', detail: `${server} (version ${health.version})` };
  } catch (err) {
    return { name: 'Server', status: 'fail', detail: (err as Error).message };
  }
}

async function checkAccount(client: Pick<ServerClient, 'me'>, config: PersonalConfig): Promise<Check[]> {
  if (!config.token) return [{ name: 'Account', status: 'fail', detail: `Not logged in. Run \`${BRAND.cli} login\`.` }];
  try {
    const me = await client.me({ signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    const access: Check =
      me.githubAuth === 'ok'
        ? { name: 'GitHub access', status: 'ok', detail: `${BRAND.name} can post in your name` }
        : { name: 'GitHub access', status: 'warn', detail: `expired: sign in again at ${new URL('/', config.server).href} so ${BRAND.name} can post in your name` };
    return [{ name: 'Account', status: 'ok', detail: `logged in as ${me.login}` }, access];
  } catch (err) {
    return [{ name: 'Account', status: 'fail', detail: (err as Error).message }];
  }
}

async function checkAgent(deps: DoctorDeps, config: PersonalConfig): Promise<Check> {
  const id = config.agent;
  const r = await deps.detectAgent(config);
  if (r.ok) return { name: 'Agent', status: 'ok', detail: `${id} ${r.version ?? ''}`.trim() };
  return { name: 'Agent', status: 'fail', detail: `${id}: ${r.problem ?? 'not usable'}` };
}

async function checkRepo(deps: DoctorDeps, name: string, path: string): Promise<Check> {
  const result = (status: Check['status'], detail: string): Check => ({ name: `Repo ${name}`, status, detail });
  if (!deps.isFolder(path)) return result('fail', `${path} doesn't exist or isn't a folder. Link the clone again: ${BRAND.cli} repos add <path>`);
  const remotes = await deps.run('git', ['-C', path, 'remote', '-v']);
  // Git ran but failed (not a clone any more, git broken): show git's own words.
  if (remotes.code !== 0) return result('fail', firstLine(remotes.stderr) ?? `git couldn't list the remotes of ${path}`);
  if (!githubReposInRemoteList(remotes.stdout).includes(name)) return result('fail', `no remote in ${path} points at ${name}`);
  // --type=bool makes git turn yes/on/1 into true itself (git 2.18+; an older git errors and we skip the warning).
  const signing = await deps.run('git', ['-C', path, 'config', '--get', '--type=bool', 'commit.gpgsign']);
  if (signing.stdout.trim() === 'true') {
    return result('warn', 'commit.gpgsign is on: a passphrase prompt would stall address jobs until they time out');
  }
  return result('ok', path);
}

function firstLine(text: string): string | undefined {
  return text.split('\n').find((line) => line.trim() !== '')?.trim();
}

const MARK: Record<Check['status'], string> = { ok: '✓', warn: '!', fail: '✗' };

/** Print the checklist. The exit code is 1 when something must be fixed. */
export function printChecks(checks: Check[], out: Out): number {
  for (const c of checks) out.log(`${MARK[c.status]} ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  out.log('');
  if (failed > 0) {
    out.log(`${failed} problem${failed === 1 ? '' : 's'} to fix.`);
    return 1;
  }
  out.log(warned > 0 ? 'Ready, with warnings above.' : 'All good.');
  return 0;
}

/** Each agent's binary. The fake agent (Task 16) ships inside the CLI. */
const AGENT_BINARIES: Record<AgentId, string | null> = { 'claude-code': 'claude', 'gemini-cli': 'gemini', fake: null };

/**
 * Is the agent installed? For an agent without an adapter yet (Gemini CLI, Task 20) this only asks the
 * binary for its version; an adapter's detect() also checks the login.
 */
export async function probeAgent(id: AgentId, run: DoctorDeps['run']): Promise<AgentCheck> {
  const binary = AGENT_BINARIES[id];
  if (!binary) return { ok: true, version: '(built in)' };
  const r = await run(binary, ['--version']);
  if (r.code === 0) return { ok: true, version: r.stdout.trim() };
  return { ok: false, problem: `\`${binary}\` is not installed (or not on your PATH)` };
}

/** `nitpilot doctor`, on this machine. */
export async function doctor(deps: { env?: Record<string, string | undefined>; out?: Out } = {}): Promise<number> {
  const out = deps.out ?? terminal;
  const env = deps.env ?? process.env;
  const checks = await runDoctor({
    nodeVersion: process.version,
    platform: process.platform,
    run: runProgram,
    loadConfig: () => loadConfig({ env }),
    client: (config) => new ServerClient(config.server, config.token),
    detectAgent: (config) => adapterFor(config, env)?.detect() ?? probeAgent(config.agent, runProgram),
    isFolder: (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false,
  });
  return printChecks(checks, out);
}
