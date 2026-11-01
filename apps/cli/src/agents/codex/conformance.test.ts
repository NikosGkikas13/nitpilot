import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../../test/temp';
import type { RunResult } from '../../run-program';
import { staticConformance } from '../conformance/static';
import { agentBaseEnv } from '../runner';
import type { AgentEvent, AgentInvocation } from '../types';
import { codexAdapter } from './adapter';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** The value after `flag`. */
const flagValue = (invocation: AgentInvocation, flag: string) => invocation.args[invocation.args.indexOf(flag) + 1];
/** The `-c key=value` overrides, as a map. */
const overrides = (invocation: AgentInvocation) =>
  Object.fromEntries(invocation.args.flatMap((arg, n) => (invocation.args[n - 1] === '-c' ? [arg.split(/=(.*)/s).slice(0, 2)] : [])));
const disabled = (invocation: AgentInvocation) => invocation.args.flatMap((arg, n) => (invocation.args[n - 1] === '--disable' ? [arg] : []));

/**
 * The built-in tools an invocation leaves the model, in Codex's terms. Codex has no tool allowlist: apply_patch
 * is always there, and the sandbox decides whether it may write. So `read` stands for apply_patch in the
 * read-only sandbox (every write refused), `write` for it in workspace-write; anything not switched off shows up
 * by name (shell, web_search, view_image, spawn_agent, apps).
 */
function codexTools(invocation: AgentInvocation): string[] {
  const off = disabled(invocation);
  const tools = flagValue(invocation, '--sandbox') === 'read-only' ? ['read'] : flagValue(invocation, '--sandbox') === 'workspace-write' ? ['write'] : ['full_access'];
  if (!off.includes('shell_tool')) tools.push('shell');
  if (overrides(invocation).web_search !== '"disabled"') tools.push('web_search');
  if (!off.includes('view_image')) tools.push('view_image');
  if (!off.includes('multi_agent')) tools.push('spawn_agent');
  if (!off.includes('apps')) tools.push('apps');
  return tools;
}

const ISOLATION = [['exec'], ['--ignore-user-config'], ['--ignore-rules'], ['--ephemeral'], ['--disable', 'hooks'], ['-c', 'approval_policy="never"'], ['-c', 'project_doc_max_bytes=0']];

staticConformance({
  adapter: codexAdapter(),
  toolsOf: codexTools,
  readTools: ['read'],
  editTools: ['write'],
  isolation: {
    reviewer: [...ISOLATION, ['--sandbox', 'read-only']],
    editor: [...ISOLATION, ['--sandbox', 'workspace-write'], ['-c', 'sandbox_workspace_write.exclude_slash_tmp=true'], ['-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true']],
  },
  // success and signal were recorded with Codex 0.166.0 in the live suite (the signal run was stopped the way runAgent
  // does it, SIGTERM to the process group); auth was recorded logged out (an empty CODEX_HOME), ids replaced; crash is a
  // recorded required MCP server that wasn't there: nothing on stdout, Codex's `Error:` on stderr. quota and
  // agent-words are written by hand (quota from protocol/src/error.rs). Codex has no max-turns setting (the job timeout covers it).
  fixtures: {
    dir: FIXTURES,
    cases: [
      { file: 'success.jsonl', code: 0, signal: null, outcome: { ok: true } },
      { file: 'auth.jsonl', code: 1, signal: null, outcome: { ok: false, reason: 'auth', retryable: false } },
      { file: 'quota.jsonl', code: 1, signal: null, outcome: { ok: false, reason: 'quota', retryable: false } },
      { file: 'crash.jsonl', code: 1, signal: null, stderr: 'Error: thread/start: thread/start failed: error creating thread: Fatal error: Failed to initialize session: required MCP servers failed to initialize: nitpilot: handshaking with MCP server failed: Send message error Transport […] error: Client error: HTTP request failed: http/request failed: error sending request for url (http://127.0.0.1:4100/mcp), when send initialize request (code -32603)\n', outcome: { ok: false, reason: 'crash', retryable: true } },
      // Its agent message talks about 429s, usage limits and logins: still a crash, read from Codex's own error only.
      { file: 'agent-words.jsonl', code: 1, signal: null, outcome: { ok: false, reason: 'crash', retryable: true } },
      { file: 'signal.jsonl', code: null, signal: 'SIGTERM', outcome: { ok: false, reason: 'crash', retryable: true } },
      { file: 'signal.jsonl', code: 1, signal: null, stderr: 'Not logged in\n', outcome: { ok: false, reason: 'auth', retryable: false } },
    ],
  },
});

describe('the Codex CLI adapter', () => {
  const input = () => ({ mode: 'reviewer' as const, cwd: '/work', prompt: '-Review this PR.', mcp: { url: 'http://127.0.0.1:4100/mcp', token: 'tok-1' }, tmpDir: tempDir(), baseEnv: agentBaseEnv(), maxTurns: 50 });

  it('runs codex exec headless, read-only, and points it at Nitpilot over MCP with the token in a file', () => {
    const i = input();
    const invocation = codexAdapter().buildInvocation(i);
    expect(invocation.command).toBe('codex');
    expect(invocation.args.slice(0, 2)).toEqual(['exec', '--json']);
    // The prompt comes last, after `--`, so one starting with a dash isn't read as a flag.
    expect(invocation.args.slice(-2)).toEqual(['--', '-Review this PR.']);
    expect(flagValue(invocation, '--sandbox')).toBe('read-only');
    expect(disabled(invocation)).toEqual(['shell_tool', 'view_image', 'multi_agent', 'apps', 'hooks']);
    const headers = invocation.files[0]!;
    expect(headers.path).toBe(`${i.tmpDir}/mcp-headers.json`);
    expect(JSON.parse(headers.content)).toEqual({ Authorization: 'Bearer tok-1' });
    expect(overrides(invocation)).toMatchObject({
      'mcp_servers.nitpilot.url': '"http://127.0.0.1:4100/mcp"',
      'mcp_servers.nitpilot.http_headers_helper': JSON.stringify(`/bin/cat '${headers.path}'`),
      'mcp_servers.nitpilot.default_tools_approval_mode': '"approve"',
      'mcp_servers.nitpilot.required': 'true',
      web_search: '"disabled"',
    });
    expect(invocation.args).not.toContain('--model');
    expect(codexAdapter().buildInvocation({ ...i, model: 'gpt-6.1-sol' }).args).toEqual(expect.arrayContaining(['--model', 'gpt-6.1-sol']));
  });

  it('lets an editor write inside the worktree only, and still no shell', () => {
    const invocation = codexAdapter().buildInvocation({ ...input(), mode: 'editor' });
    expect(flagValue(invocation, '--sandbox')).toBe('workspace-write');
    expect(disabled(invocation)).toContain('shell_tool');
    expect(overrides(invocation)['sandbox_workspace_write.network_access']).toBe('false');
  });

  it('quotes a temp folder with a quote in it for sh', () => {
    const invocation = codexAdapter().buildInvocation({ ...input(), tmpDir: "/tmp/it's" });
    expect(overrides(invocation)['mcp_servers.nitpilot.http_headers_helper']).toBe(JSON.stringify(`/bin/cat '/tmp/it'\\''s/mcp-headers.json'`));
  });

  it('turns MCP calls and its own words into progress, and drops the rest', () => {
    const events = readFileSync(`${FIXTURES}success.jsonl`, 'utf8').split('\n').map((line) => codexAdapter().parseLine(line)).filter((e): e is AgentEvent => e !== null);
    expect(events).toEqual([
      { type: 'progress', text: 'I’ll inspect the reviewer job instructions first, then review the changed files and post a point for each concrete issue I find.' },
      { type: 'progress', text: 'Using get_job' },
      { type: 'progress', text: 'Using list_changed_files' },
      { type: 'progress', text: 'Using get_diff' },
      { type: 'progress', text: 'Using get_file' },
      { type: 'progress', text: 'Using add_point' },
      { type: 'progress', text: 'Using finish' },
      { type: 'progress', text: 'Reviewed `src/orders.ts` and raised one major point: the change adds only a page size constant and does not implement cursor pagination.' },
      { type: 'result', ok: true, text: '' },
    ]);
  });

  it('trusts the exit code over a completed turn', () => {
    const ok: AgentEvent = { type: 'result', ok: true, text: '' };
    expect(codexAdapter().outcome({ code: 1, signal: null, last: ok, stderrTail: '' })).toEqual({ ok: false, reason: 'crash', retryable: true });
  });

  describe('detect', () => {
    const run = (answers: Record<string, Partial<RunResult>>) => async (file: string, args: string[]): Promise<RunResult> => ({ code: null, stdout: '', stderr: 'ENOENT', ...answers[[file, ...args].join(' ')] });

    it('is ready when codex is installed and logged in, and names its version', async () => {
      const ready = run({ 'codex --version': { code: 0, stdout: 'codex-cli 0.166.0\n' }, 'codex login status': { code: 0, stderr: 'Logged in using ChatGPT\n' } });
      expect(await codexAdapter({ run: ready }).detect()).toEqual({ ok: true, version: 'codex-cli 0.166.0' });
    });

    it('says to log in when it is not', async () => {
      const loggedOut = run({ 'codex --version': { code: 0, stdout: 'codex-cli 0.166.0\n' }, 'codex login status': { code: 1, stderr: 'Not logged in\n' } });
      expect(await codexAdapter({ run: loggedOut }).detect()).toEqual({ ok: false, version: 'codex-cli 0.166.0', problem: 'Codex is not logged in: run `codex login`' });
    });

    it('says what to do when codex is missing', async () => {
      expect(await codexAdapter({ run: run({}) }).detect()).toEqual({ ok: false, problem: '`codex` is not installed (or not on your PATH)' });
    });

    it('checks with the allowlisted environment: no API key, but CODEX_HOME', async () => {
      const seen: Record<string, string>[] = [];
      const spy = async (_file: string, _args: string[], o?: { env?: Record<string, string> }): Promise<RunResult> => (seen.push(o?.env ?? {}), { code: 0, stdout: 'codex-cli 0.166.0\n', stderr: '' });
      await codexAdapter({ run: spy, env: { PATH: '/bin', CODEX_HOME: '/me/.codex', OPENAI_API_KEY: 'sk-x', CODEX_API_KEY: 'sk-y' } }).detect();
      for (const env of seen) expect(env).toEqual({ PATH: '/bin', CODEX_HOME: '/me/.codex' });
    });
  });
});
