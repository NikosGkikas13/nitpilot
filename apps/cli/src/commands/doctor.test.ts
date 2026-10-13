import { BRAND } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { recordOut } from '../../test/out';
import { PersonalConfigSchema } from '../config/config';
import { CliError } from '../errors';
import { ServerError } from '../http';
import type { RunResult } from '../run-program';
import { printChecks, probeAgent, runDoctor, type Check, type DoctorDeps } from './doctor';

const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' });
const missing: RunResult = { code: null, stdout: '', stderr: 'spawn ENOENT' };

/** A pretend `run`, answering by command line ('git --version'). Anything else exits with 1. */
function fakeRun(answers: Record<string, RunResult>): DoctorDeps['run'] {
  return async (file, args) => answers[[file, ...args].join(' ')] ?? { code: 1, stdout: '', stderr: '' };
}

const GIT: Record<string, RunResult> = {
  'git --version': ok('git version 2.47.0\n'),
  'git -C /code/shop-api remote -v': ok('origin\tgit@github.com:acme/shop-api.git (fetch)\norigin\tgit@github.com:acme/shop-api.git (push)\n'),
};

const server = {
  health: async () => ({ ok: true, version: '0.1.0' }),
  me: async () => ({ login: 'maya', avatarUrl: null, githubAuth: 'ok' as const }),
};

/** A machine where everything is fine. Each test breaks one thing. */
function healthy(over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    nodeVersion: 'v22.12.0',
    platform: 'darwin',
    run: fakeRun(GIT),
    loadConfig: () => PersonalConfigSchema.parse({ server: 'https://nitpilot.test', token: 'nit_abc', repos: { 'acme/shop-api': { path: '/code/shop-api' } } }),
    client: () => server,
    detectAgent: async () => ({ ok: true, version: '2.1.29 (Claude Code)' }),
    isFolder: () => true,
    ...over,
  };
}

const find = (checks: Check[], name: string) => checks.find((c) => c.name === name);

describe('runDoctor', () => {
  it('passes every check on a healthy machine', async () => {
    const checks = await runDoctor(healthy());
    expect(checks.map((c) => [c.name, c.status])).toEqual([
      ['Node', 'ok'],
      ['Platform', 'ok'],
      ['git', 'ok'],
      ['Config', 'ok'],
      ['Server', 'ok'],
      ['Account', 'ok'],
      ['GitHub access', 'ok'],
      ['Agent', 'ok'],
      ['Repo acme/shop-api', 'ok'],
    ]);
    expect(find(checks, 'GitHub access')?.detail).toBe(`${BRAND.name} can post in your name`);
    expect(find(checks, 'Agent')?.detail).toBe('claude-code 2.1.29 (Claude Code)');
  });

  it('fails on a Node older than 22', async () => {
    expect(find(await runDoctor(healthy({ nodeVersion: 'v20.18.0' })), 'Node')).toMatchObject({ status: 'fail', detail: expect.stringContaining('needs Node 22') });
  });

  it('warns on Windows', async () => {
    expect(find(await runDoctor(healthy({ platform: 'win32' })), 'Platform')).toMatchObject({ status: 'warn' });
  });

  it('fails without git', async () => {
    expect(find(await runDoctor(healthy({ run: fakeRun({ ...GIT, 'git --version': missing }) })), 'git')).toMatchObject({ status: 'fail' });
  });

  it('stops at a broken config, showing its message', async () => {
    const loadConfig = () => {
      throw new CliError('Invalid setting "concurrency" in config.json');
    };
    const checks = await runDoctor(healthy({ loadConfig }));
    expect(find(checks, 'Config')).toEqual({ name: 'Config', status: 'fail', detail: 'Invalid setting "concurrency" in config.json' });
    expect(find(checks, 'Server')).toBeUndefined();
  });

  it("fails when the server can't be reached, and skips the account checks", async () => {
    const unreachable = {
      ...server,
      health: async (): Promise<never> => {
        throw new ServerError(0, "Can't reach https://nitpilot.test: fetch failed");
      },
    };
    const checks = await runDoctor(healthy({ client: () => unreachable }));
    expect(find(checks, 'Server')).toMatchObject({ status: 'fail', detail: expect.stringContaining("Can't reach") });
    expect(find(checks, 'Account')).toBeUndefined();
  });

  it('gives both network checks a deadline, so a silent server cannot hang doctor', async () => {
    const signals: Record<string, AbortSignal | undefined> = {};
    const recording = {
      health: async (opts?: { signal?: AbortSignal }) => {
        signals.health = opts?.signal;
        return { ok: true, version: '0.1.0' };
      },
      me: async (opts?: { signal?: AbortSignal }) => {
        signals.me = opts?.signal;
        return { login: 'maya', avatarUrl: null, githubAuth: 'ok' as const };
      },
    };
    await runDoctor(healthy({ client: () => recording }));
    expect(signals.health).toBeInstanceOf(AbortSignal);
    expect(signals.me).toBeInstanceOf(AbortSignal);
  });

  it('fails when not logged in', async () => {
    const config = PersonalConfigSchema.parse({ server: 'https://nitpilot.test' });
    expect(find(await runDoctor(healthy({ loadConfig: () => config })), 'Account')).toMatchObject({ status: 'fail', detail: 'Not logged in. Run `nitpilot login`.' });
  });

  it('fails when the server rejects the token', async () => {
    const rejected = {
      ...server,
      me: async (): Promise<never> => {
        throw new ServerError(401, "The server didn't accept this device's token. Run `nitpilot login`.");
      },
    };
    expect(find(await runDoctor(healthy({ client: () => rejected })), 'Account')).toMatchObject({ status: 'fail', detail: expect.stringContaining('nitpilot login') });
  });

  it('warns when GitHub access needs a new sign-in', async () => {
    const expired = { ...server, me: async () => ({ login: 'maya', avatarUrl: null, githubAuth: 'needs_reauth' as const }) };
    expect(find(await runDoctor(healthy({ client: () => expired })), 'GitHub access')).toMatchObject({ status: 'warn' });
  });

  it('fails when the agent is not installed', async () => {
    const checks = await runDoctor(healthy({ detectAgent: async () => ({ ok: false, problem: '`claude` is not installed (or not on your PATH)' }) }));
    expect(find(checks, 'Agent')).toEqual({ name: 'Agent', status: 'fail', detail: 'claude-code: `claude` is not installed (or not on your PATH)' });
  });

  it("fails when a linked clone's folder is gone", async () => {
    expect(find(await runDoctor(healthy({ isFolder: () => false })), 'Repo acme/shop-api')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining("/code/shop-api doesn't exist or isn't a folder"),
    });
  });

  it("reports git's own error when the clone's remotes can't be read", async () => {
    const remotes = 'git -C /code/shop-api remote -v';
    const notAClone: RunResult = { code: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' };
    expect(find(await runDoctor(healthy({ run: fakeRun({ ...GIT, [remotes]: notAClone }) })), 'Repo acme/shop-api')).toEqual({
      name: 'Repo acme/shop-api',
      status: 'fail',
      detail: 'fatal: not a git repository (or any of the parent directories): .git',
    });
    // git said nothing: a short text of our own
    const silent = fakeRun({ ...GIT, [remotes]: { code: 1, stdout: '', stderr: '' } });
    expect(find(await runDoctor(healthy({ run: silent })), 'Repo acme/shop-api')).toMatchObject({ status: 'fail', detail: expect.stringContaining("git couldn't list the remotes of /code/shop-api") });
  });

  it("fails when a linked clone's remotes point elsewhere", async () => {
    const run = fakeRun({ ...GIT, 'git -C /code/shop-api remote -v': ok('origin\tgit@github.com:maya/other.git (fetch)\n') });
    expect(find(await runDoctor(healthy({ run })), 'Repo acme/shop-api')).toMatchObject({ status: 'fail', detail: 'no remote in /code/shop-api points at acme/shop-api' });
  });

  it('warns when commit signing could stall a job on a passphrase prompt', async () => {
    const run = fakeRun({ ...GIT, 'git -C /code/shop-api config --get --type=bool commit.gpgsign': ok('true\n') });
    expect(find(await runDoctor(healthy({ run })), 'Repo acme/shop-api')).toMatchObject({ status: 'warn', detail: expect.stringContaining('commit.gpgsign') });
  });
});

describe('probeAgent', () => {
  it("asks the agent's binary for its version", async () => {
    expect(await probeAgent('claude-code', fakeRun({ 'claude --version': ok('2.1.29 (Claude Code)\n') }))).toEqual({ ok: true, version: '2.1.29 (Claude Code)' });
    expect(await probeAgent('gemini-cli', fakeRun({ 'gemini --version': missing }))).toEqual({ ok: false, problem: '`gemini` is not installed (or not on your PATH)' });
    expect(await probeAgent('fake', fakeRun({}))).toEqual({ ok: true, version: '(built in)' });
  });
});

describe('printChecks', () => {
  it('prints one line per check, and exits with 1 only when something failed', () => {
    const out = recordOut();
    const checks: Check[] = [
      { name: 'Node', status: 'ok', detail: 'v22.12.0' },
      { name: 'Platform', status: 'warn', detail: 'Windows' },
    ];
    expect(printChecks(checks, out)).toBe(0);
    expect(out.lines).toEqual(['✓ Node: v22.12.0', '! Platform: Windows', '', 'Ready, with warnings above.']);

    // failures are counted, with the right plural
    const git: Check = { name: 'git', status: 'fail', detail: 'missing' };
    const node: Check = { name: 'Node', status: 'fail', detail: 'v20' };
    const one = recordOut();
    expect(printChecks([git], one)).toBe(1);
    expect(one.lines).toEqual(['✗ git: missing', '', '1 problem to fix.']);
    const two = recordOut();
    expect(printChecks([git, node], two)).toBe(1);
    expect(two.lines.at(-1)).toBe('2 problems to fix.');
  });
});
