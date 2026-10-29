import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../../../test/temp';
import type { RunResult } from '../../run-program';
import { staticConformance } from '../conformance/static';
import { agentBaseEnv } from '../runner';
import type { AgentEvent, AgentInvocation } from '../types';
import { copilotAdapter } from './adapter';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** The values after `flag`, up to the next flag. */
const flagValues = (invocation: AgentInvocation, flag: string) => {
  const rest = invocation.args.slice(invocation.args.indexOf(flag) + 1);
  const end = rest.findIndex((arg) => arg.startsWith('-'));
  return end < 0 ? rest : rest.slice(0, end);
};
const ISOLATION = [['--no-custom-instructions'], ['--disable-builtin-mcps'], ['--no-ask-user'], ['--disallow-temp-dir'], ['--no-auto-update']];

staticConformance({
  adapter: copilotAdapter(),
  // The built-in tools: --available-tools without Nitpilot's own MCP server.
  toolsOf: (invocation) => flagValues(invocation, '--available-tools').filter((tool) => tool !== 'nitpilot'),
  readTools: ['view', 'grep', 'rg', 'glob'],
  editTools: ['edit', 'create', 'apply_patch'],
  isolation: {
    reviewer: [...ISOLATION, ['--allow-tool', 'nitpilot', '--additional-mcp-config']],
    editor: [...ISOLATION, ['--allow-tool', 'nitpilot', 'write', '--additional-mcp-config']],
  },
  // success and signal were recorded with Copilot CLI 1.0.105 (deltas dropped, paths and ids replaced); the
  // signal run was stopped the way runAgent does it, SIGTERM to the process group. Copilot has no max-turns
  // flag (the job timeout covers it). auth and quota are written by hand: stdout empty or cut short, and the
  // stderr wording from the docs.
  fixtures: {
    dir: FIXTURES,
    cases: [
      { file: 'success.jsonl', code: 0, signal: null, outcome: { ok: true } },
      { file: 'auth.jsonl', code: 1, signal: null, stderr: 'Error: No authentication information found.\n\nCopilot can be authenticated with GitHub using an OAuth Token or a Fine-Grained Personal Access Token.\n', outcome: { ok: false, reason: 'auth', retryable: false } },
      { file: 'quota.jsonl', code: 1, signal: null, stderr: 'Error: You have reached your monthly limit of AI credits.\n', outcome: { ok: false, reason: 'quota', retryable: false } },
      // Recorded: a missing MCP config file, and a model the plan doesn't include.
      { file: 'crash.jsonl', code: 1, signal: null, stderr: 'Failed to read MCP config file "/tmp/nitpilot-x/mcp.json": No such file or directory (os error 2)\n', outcome: { ok: false, reason: 'crash', retryable: true } },
      { file: 'crash.jsonl', code: 1, signal: null, stderr: 'Error: Model "claude-sonnet-5.5" from --model flag is not available.\n', outcome: { ok: false, reason: 'crash', retryable: true } },
      // A crash whose stderr merely mentions login and 401/429 (a file path, an MCP error): still a crash, not auth or quota.
      { file: 'crash.jsonl', code: 1, signal: null, stderr: 'SyntaxError: Unexpected token in /Users/me/.config/nitpilot/worktrees/acme/login-service/429-reviewer-j1-1/src/login.ts\nMCP server nitpilot failed: 401 Unauthorized\n', outcome: { ok: false, reason: 'crash', retryable: true } },
      // Its last line is a `result` with exitCode 0: the exit code still says it was stopped.
      { file: 'signal.jsonl', code: null, signal: 'SIGTERM', outcome: { ok: false, reason: 'crash', retryable: true } },
    ],
  },
});

describe('the Copilot CLI adapter', () => {
  const input = () => ({ mode: 'reviewer' as const, cwd: '/work', prompt: 'Review this PR.', mcp: { url: 'http://127.0.0.1:4100/mcp', token: 'tok-1' }, tmpDir: tempDir(), baseEnv: agentBaseEnv(), maxTurns: 50 });

  it('runs copilot headless with the spec §12.2 flags, and points it at Nitpilot over MCP from a file', () => {
    const i = input();
    const invocation = copilotAdapter().buildInvocation(i);
    expect(invocation.command).toBe('copilot');
    expect(invocation.args.slice(0, 4)).toEqual(['-p', 'Review this PR.', '--output-format', 'json']);
    expect(flagValues(invocation, '--available-tools')).toEqual(['view', 'grep', 'rg', 'glob', 'nitpilot']);
    expect(flagValues(invocation, '--allow-tool')).toEqual(['nitpilot']);
    expect(JSON.parse(invocation.files[0]!.content)).toEqual({
      mcpServers: { nitpilot: { type: 'http', url: 'http://127.0.0.1:4100/mcp', headers: { Authorization: 'Bearer tok-1' }, tools: ['*'] } },
    });
    expect(flagValues(invocation, '--additional-mcp-config')).toEqual([`@${invocation.files[0]!.path}`]);
    expect(invocation.args).not.toContain('--trust-folder');
    expect(invocation.args).not.toContain('--model');
    expect(copilotAdapter().buildInvocation({ ...i, model: 'claude-sonnet-5.5' }).args).toEqual(expect.arrayContaining(['--model', 'claude-sonnet-5.5']));
  });

  it('lets an editor write, and nothing else', () => {
    const invocation = copilotAdapter().buildInvocation({ ...input(), mode: 'editor' });
    expect(flagValues(invocation, '--allow-tool')).toEqual(['nitpilot', 'write']);
    expect(flagValues(invocation, '--available-tools')).toEqual(['view', 'grep', 'rg', 'glob', 'edit', 'create', 'apply_patch', 'nitpilot']);
  });

  it('turns tool calls and its own words into progress, and drops the rest', () => {
    const events = readFileSync(`${FIXTURES}success.jsonl`, 'utf8').split('\n').map((line) => copilotAdapter().parseLine(line)).filter((e): e is AgentEvent => e !== null);
    expect(events).toEqual([
      { type: 'progress', text: 'Using grep' },
      { type: 'progress', text: 'Using glob' },
      { type: 'progress', text: 'Using view' },
      { type: 'progress', text: 'Using finish' },
      { type: 'progress', text: 'Done.' },
      { type: 'result', ok: true, text: '' },
    ]);
  });

  it("reads only Copilot's own error lines, never the agent's words", () => {
    const adapter = copilotAdapter();
    const ok: AgentEvent = { type: 'result', ok: true, text: '' };
    expect(adapter.outcome({ code: 1, signal: null, last: ok, stderrTail: 'Fixed the login flow; a 429 or 401 is retried now.\n' })).toEqual({ ok: false, reason: 'crash', retryable: true });
    expect(adapter.outcome({ code: 0, signal: null, last: { type: 'result', ok: false, text: 'exit code 1' }, stderrTail: '' })).toEqual({ ok: false, reason: 'crash', retryable: true });
  });

  describe('detect', () => {
    const run = (answers: Record<string, Partial<RunResult>>) => async (file: string, args: string[]): Promise<RunResult> => ({ code: null, stdout: '', stderr: 'ENOENT', ...answers[[file, ...args].join(' ')] });

    it('is ready when copilot is installed, and names its version', async () => {
      const installed = run({ 'copilot --version': { code: 0, stdout: "GitHub Copilot CLI 1.0.105.\nRun 'copilot update' to check for updates.\n" } });
      expect(await copilotAdapter({ run: installed }).detect()).toEqual({ ok: true, version: 'GitHub Copilot CLI 1.0.105.' });
    });

    it('says what to do when copilot is missing', async () => {
      expect(await copilotAdapter({ run: run({}) }).detect()).toEqual({ ok: false, problem: '`copilot` is not installed (or not on your PATH)' });
    });
  });
});
