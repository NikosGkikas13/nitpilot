import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../../test/temp';
import type { RunResult } from '../../run-program';
import { staticConformance } from '../conformance/static';
import { adapterFor } from '../registry';
import { agentBaseEnv } from '../runner';
import type { AgentEvent, AgentInvocation } from '../types';
import { geminiCliAdapter } from './adapter';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** The value of `flag` in an invocation's arguments. */
const flagValue = (invocation: AgentInvocation, flag: string) => invocation.args[invocation.args.indexOf(flag) + 1] ?? '';
/** The settings file an invocation writes (the one in `.gemini/`), parsed. */
const settingsOf = (invocation: AgentInvocation) => JSON.parse(invocation.files.find((file) => file.path.endsWith('settings.json'))!.content);
const policyOf = (invocation: AgentInvocation) => invocation.files.find((file) => file.path.endsWith('policy.toml'))!.content;

const ISOLATION = [['--skip-trust'], ['-e', 'none'], ['--allowed-mcp-server-names', 'nitpilot'], ['-o', 'stream-json']];

staticConformance({
  adapter: geminiCliAdapter(),
  toolsOf: (invocation) => settingsOf(invocation).tools.core,
  readTools: ['read_file', 'read_many_files', 'list_directory', 'glob', 'grep_search'],
  editTools: ['replace', 'write_file'],
  isolation: {
    reviewer: [...ISOLATION, ['--approval-mode', 'default']],
    editor: [...ISOLATION, ['--approval-mode', 'auto_edit']],
  },
  optIn: { key: 'GEMINI_API_KEY', adapter: (env) => adapterFor({ agent: 'gemini-cli', apiBilling: true }, env)! },
  // auth.jsonl is a real run (Gemini CLI 0.63.0, an invalid key; ids and times replaced), and so are the no-key
  // stderr below and quota.jsonl. The others copy the event shapes in 0.63.0's stream-json writer by hand until they are
  // recorded live with a key (npm run test:live).
  fixtures: {
    dir: FIXTURES,
    cases: [
      { file: 'success.jsonl', code: 0, signal: null, outcome: { ok: true } },
      { file: 'max_turns.jsonl', code: 53, signal: null, outcome: { ok: false, reason: 'max_turns', retryable: false } },
      { file: 'auth.jsonl', code: 144, signal: null, outcome: { ok: false, reason: 'auth', retryable: false } },
      { file: 'crash.jsonl', code: 41, signal: null, stderr: 'When using Gemini API, you must specify the GEMINI_API_KEY environment variable.\nUpdate your environment and try again (no reload needed if using .env)!\n', outcome: { ok: false, reason: 'auth', retryable: false } },
      // Recorded with 0.66.0 on a free-tier key: 20 requests a day, then this (exit 173 is 429 cut to a byte).
      { file: 'quota.jsonl', code: 173, signal: null, outcome: { ok: false, reason: 'quota', retryable: false } },
      { file: 'crash.jsonl', code: 1, signal: null, stderr: 'Error: Cannot find module /usr/lib/gemini/x.js\n', outcome: { ok: false, reason: 'crash', retryable: true } },
      // A crash whose stderr merely mentions a quota, login or 429 in a path: still a crash.
      { file: 'crash.jsonl', code: 1, signal: null, stderr: 'SyntaxError: Unexpected token in /Users/me/work/login-service/429-quota/src/login.ts\n', outcome: { ok: false, reason: 'crash', retryable: true } },
      { file: 'signal.jsonl', code: null, signal: 'SIGTERM', outcome: { ok: false, reason: 'crash', retryable: true } },
    ],
  },
});

describe('the Gemini CLI adapter', () => {
  const input = () => ({ mode: 'reviewer' as const, cwd: '/work', prompt: 'Review this PR.', mcp: { url: 'http://127.0.0.1:4100/mcp', token: 'tok-1' }, tmpDir: tempDir(), baseEnv: agentBaseEnv(), maxTurns: 50 });

  it('runs gemini headless, and points it at Nitpilot over MCP with a settings file in its private home', () => {
    const i = input();
    const invocation = geminiCliAdapter().buildInvocation(i);
    expect(invocation.command).toBe('gemini');
    expect(invocation.args.slice(0, 4)).toEqual(['-p', 'Review this PR.', '-o', 'stream-json']);
    expect(invocation.env.GEMINI_CLI_HOME).toBe(i.tmpDir);
    expect(invocation.files.map((file) => file.path)).toEqual([`${i.tmpDir}/.gemini/settings.json`, `${i.tmpDir}/policy.toml`]);
    expect(flagValue(invocation, '--policy')).toBe(`${i.tmpDir}/policy.toml`);
    expect(settingsOf(invocation)).toEqual({
      mcpServers: { nitpilot: { httpUrl: 'http://127.0.0.1:4100/mcp', headers: { Authorization: 'Bearer tok-1' }, trust: true } },
      tools: { core: ['read_file', 'read_many_files', 'list_directory', 'glob', 'grep_search'] },
      hooksConfig: { enabled: false },
      experimental: { enableAgents: false },
      advanced: { ignoreLocalEnv: true },
      model: { maxSessionTurns: 50 },
      security: { auth: { selectedType: 'gemini-api-key' } },
    });
    expect(invocation.args).not.toContain('-m');
    expect(geminiCliAdapter().buildInvocation({ ...i, model: 'gemini-3-pro' }).args).toEqual(expect.arrayContaining(['-m', 'gemini-3-pro']));
  });

  it('refuses every tool but the mode’s own and Nitpilot’s, and the shell and the web above all', () => {
    // Checked against Gemini CLI 0.63.0, which only warns about a policy file it can't read.
    expect(policyOf(geminiCliAdapter().buildInvocation(input()))).toBe(
      [
        '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 1\n',
        '[[rule]]\ntoolName = ["read_file", "read_many_files", "list_directory", "glob", "grep_search"]\ndecision = "allow"\npriority = 900\n',
        '[[rule]]\nmcpName = "nitpilot"\ntoolName = "*"\ndecision = "allow"\npriority = 900\n',
        '[[rule]]\ntoolName = ["run_shell_command", "web_fetch", "google_web_search"]\ndecision = "deny"\npriority = 999\n',
      ].join('\n'),
    );
    expect(policyOf(geminiCliAdapter().buildInvocation({ ...input(), mode: 'editor' }))).toContain('"grep_search", "replace", "write_file"]\ndecision = "allow"');
  });

  it('never puts the key on the command line, and passes GEMINI_API_KEY (not GOOGLE_API_KEY) only with apiBilling on', () => {
    const env = { ...process.env, GEMINI_API_KEY: 'AIza-mine', GOOGLE_API_KEY: 'AIza-cloud' };
    const withKey = adapterFor({ agent: 'gemini-cli', apiBilling: true }, env)!.buildInvocation(input());
    const withoutKey = adapterFor({ agent: 'gemini-cli', apiBilling: false }, env)!.buildInvocation(input());
    expect(withKey.env.GEMINI_API_KEY).toBe('AIza-mine');
    expect(withKey.env).not.toHaveProperty('GOOGLE_API_KEY');
    expect(withoutKey.env).not.toHaveProperty('GEMINI_API_KEY');
    for (const invocation of [withKey, withoutKey]) expect(JSON.stringify([invocation.args, invocation.files])).not.toContain('AIza');
  });

  it('turns tool calls into progress, and drops its streamed words and the rest', () => {
    const events = readFileSync(`${FIXTURES}success.jsonl`, 'utf8').split('\n').map((line) => geminiCliAdapter().parseLine(line)).filter((e): e is AgentEvent => e !== null);
    expect(events).toEqual([
      { type: 'progress', text: 'Using get_job' },
      { type: 'progress', text: 'Using read_file' },
      { type: 'progress', text: 'Using finish' },
      { type: 'result', ok: true, text: '' },
    ]);
  });

  it('trusts the exit code over a successful result', () => {
    const okResult: AgentEvent = { type: 'result', ok: true, text: '' };
    expect(geminiCliAdapter().outcome({ code: 1, signal: null, last: okResult, stderrTail: '' })).toEqual({ ok: false, reason: 'crash', retryable: true });
  });

  describe('detect', () => {
    const run = (answers: Record<string, Partial<RunResult>>) => async (file: string, args: string[]): Promise<RunResult> => ({ code: null, stdout: '', stderr: 'ENOENT', ...answers[[file, ...args].join(' ')] });
    const installed = { 'gemini --version': { code: 0, stdout: '0.63.0\n' } };

    it('is ready when gemini is installed, apiBilling is on and the key is set', async () => {
      expect(await geminiCliAdapter({ apiBilling: true, apiKey: 'AIza-mine', run: run(installed) }).detect()).toEqual({ ok: true, version: '0.63.0' });
    });

    it('says to turn apiBilling on when it is off, and to set the key when it is missing', async () => {
      expect(await geminiCliAdapter({ run: run(installed) }).detect()).toEqual({ ok: false, version: '0.63.0', problem: 'Gemini CLI bills your own API key: turn apiBilling on in the config and set GEMINI_API_KEY' });
      expect(await geminiCliAdapter({ apiBilling: true, run: run(installed) }).detect()).toEqual({ ok: false, version: '0.63.0', problem: 'apiBilling is on, but GEMINI_API_KEY is not set: set it to your Google AI Studio key' });
    });

    it('says what to do when gemini is missing', async () => {
      expect(await geminiCliAdapter({ run: run({}) }).detect()).toEqual({ ok: false, problem: '`gemini` is not installed (or not on your PATH)' });
    });

    it('checks with the allowlisted environment: no API key reaches gemini --version', async () => {
      const seen: Record<string, string>[] = [];
      const spy = async (_file: string, _args: string[], o?: { env?: Record<string, string> }): Promise<RunResult> => (seen.push(o?.env ?? {}), { code: 0, stdout: '0.63.0\n', stderr: '' });
      await geminiCliAdapter({ run: spy, env: { PATH: '/bin', GEMINI_API_KEY: 'AIza-x', GOOGLE_API_KEY: 'AIza-y' } }).detect();
      expect(seen).toEqual([{ PATH: '/bin' }]);
    });
  });
});
