import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../../test/temp';
import type { RunResult } from '../../run-program';
import { staticConformance } from '../conformance/static';
import { adapterFor } from '../registry';
import { agentBaseEnv } from '../runner';
import type { AgentEvent, AgentInvocation } from '../types';
import { claudeCodeAdapter } from './adapter';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** The value of `flag` in an invocation's arguments. */
const flagValue = (invocation: AgentInvocation, flag: string) => invocation.args[invocation.args.indexOf(flag) + 1] ?? '';

staticConformance({
  adapter: claudeCodeAdapter(),
  toolsOf: (invocation) => flagValue(invocation, '--tools').split(','),
  readTools: ['Read', 'Glob', 'Grep'],
  editTools: ['Edit', 'Write'],
  isolation: {
    reviewer: [['--permission-mode', 'dontAsk'], ['--strict-mcp-config'], ['--setting-sources', 'user'], ['--settings', '{"disableAllHooks":true}'], ['--disable-slash-commands'], ['--allowedTools', 'mcp__nitpilot']],
    editor: [['--permission-mode', 'acceptEdits'], ['--strict-mcp-config'], ['--setting-sources', 'user'], ['--settings', '{"disableAllHooks":true}'], ['--disable-slash-commands'], ['--allowedTools', 'mcp__nitpilot']],
  },
  // Recorded with Claude Code 2.1.277 (paths and ids replaced). quota.jsonl is written by hand: a plan's
  // limit can't be reached on purpose, so its lines copy the shapes and wording of the recorded runs.
  fixtures: {
    dir: FIXTURES,
    cases: [
      { file: 'success.jsonl', code: 0, signal: null, outcome: { ok: true } },
      { file: 'max_turns.jsonl', code: 1, signal: null, outcome: { ok: false, reason: 'max_turns', retryable: false } },
      { file: 'auth.jsonl', code: 1, signal: null, outcome: { ok: false, reason: 'auth', retryable: false } },
      { file: 'quota.jsonl', code: 1, signal: null, outcome: { ok: false, reason: 'quota', retryable: false } },
      { file: 'crash.jsonl', code: 1, signal: null, stderr: 'Error: Invalid MCP configuration:\nMCP config file not found: /tmp/nitpilot-x/mcp.json\n', outcome: { ok: false, reason: 'crash', retryable: true } },
      { file: 'signal.jsonl', code: null, signal: 'SIGTERM', outcome: { ok: false, reason: 'crash', retryable: true } },
    ],
  },
});

describe('the Claude Code adapter', () => {
  const input = () => ({ mode: 'reviewer' as const, cwd: '/work', prompt: 'Review this PR.', mcp: { url: 'http://127.0.0.1:4100/mcp', token: 'tok-1' }, tmpDir: tempDir(), baseEnv: agentBaseEnv(), maxTurns: 50 });

  it('runs claude headless with the spec §12.2 flags, and points it at Nitpilot over MCP', () => {
    const i = input();
    const invocation = claudeCodeAdapter().buildInvocation(i);
    expect(invocation.command).toBe('claude');
    expect(invocation.args.slice(0, 6)).toEqual(['-p', 'Review this PR.', '--output-format', 'stream-json', '--verbose', '--max-turns']);
    expect(flagValue(invocation, '--max-turns')).toBe('50');
    expect(flagValue(invocation, '--tools')).toBe('Read,Glob,Grep');
    expect(JSON.parse(invocation.files[0]!.content)).toEqual({
      mcpServers: { nitpilot: { type: 'http', url: 'http://127.0.0.1:4100/mcp', headers: { Authorization: 'Bearer tok-1' }, alwaysLoad: true } },
    });
    expect(flagValue(invocation, '--mcp-config')).toBe(invocation.files[0]!.path);
    expect(invocation.args).not.toContain('--model');
    expect(claudeCodeAdapter().buildInvocation({ ...i, model: 'opus' }).args).toEqual(expect.arrayContaining(['--model', 'opus']));
  });

  it('passes ANTHROPIC_API_KEY only when you opted into API billing', () => {
    const env = { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-mine' };
    const withKey = adapterFor({ agent: 'claude-code', apiBilling: true }, env)!.buildInvocation(input());
    const withoutKey = adapterFor({ agent: 'claude-code', apiBilling: false }, env)!.buildInvocation(input());
    expect(withKey.env.ANTHROPIC_API_KEY).toBe('sk-ant-mine');
    expect(withoutKey.env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('turns tool calls and its own words into progress, and drops the rest', () => {
    const events = readFileSync(`${FIXTURES}success.jsonl`, 'utf8').split('\n').map((line) => claudeCodeAdapter().parseLine(line)).filter((e): e is AgentEvent => e !== null);
    expect(events.slice(0, 3)).toEqual([
      { type: 'progress', text: "I'll start by getting the job details for this review." },
      { type: 'progress', text: 'Using get_job' },
      { type: 'progress', text: 'Now let me look at the changed files.' },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'result', ok: true });
  });

  describe('detect', () => {
    const run = (answers: Record<string, Partial<RunResult>>) => async (file: string, args: string[]): Promise<RunResult> => ({ code: null, stdout: '', stderr: 'ENOENT', ...answers[[file, ...args].join(' ')] });
    const installed = { 'claude --version': { code: 0, stdout: '2.1.277 (Claude Code)\n' } };

    it('is ready when claude is installed and logged in', async () => {
      const ready = run({ ...installed, 'claude auth status': { code: 0, stdout: '{"loggedIn":true,"authMethod":"claude.ai"}' } });
      expect(await claudeCodeAdapter({ run: ready }).detect()).toEqual({ ok: true, version: '2.1.277 (Claude Code)' });
    });

    it('says what to do when claude is missing or logged out', async () => {
      expect(await claudeCodeAdapter({ run: run({}) }).detect()).toEqual({ ok: false, problem: '`claude` is not installed (or not on your PATH)' });
      const loggedOut = run({ ...installed, 'claude auth status': { code: 1, stdout: '{"loggedIn":false,"authMethod":"none"}' } });
      expect(await claudeCodeAdapter({ run: loggedOut }).detect()).toEqual({ ok: false, version: '2.1.277 (Claude Code)', problem: 'Claude Code is not logged in: run `claude auth login`' });
    });

    it("doesn't need a login when it bills your API key", async () => {
      expect(await claudeCodeAdapter({ apiKey: 'sk-ant-mine', run: run(installed) }).detect()).toEqual({ ok: true, version: '2.1.277 (Claude Code)' });
    });
  });
});
