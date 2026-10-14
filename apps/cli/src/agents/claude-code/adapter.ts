import { join } from 'node:path';
import { BRAND } from '@nitpilot/protocol';
import { runProgram, type RunProgram } from '../../run-program';
import type { AgentAdapter, AgentEvent, AgentMode, AgentOutcome } from '../types';

/** The Claude Code version these flags were checked against (spec §12.2). The live conformance suite catches drift. */
export const CLAUDE_CODE_CHECKED_VERSION = '2.1.277';

/** Built-in tools per mode (spec §12.3 S1): a reviewer reads, an editor also edits. No Bash, no web, no subagents. */
const TOOLS: Record<AgentMode, readonly string[]> = {
  reviewer: ['Read', 'Glob', 'Grep'],
  editor: ['Read', 'Glob', 'Grep', 'Edit', 'Write'],
};
/** dontAsk: anything not allowed is refused, never asked about. acceptEdits: edits inside the worktree go through. */
const PERMISSION_MODE: Record<AgentMode, string> = { reviewer: 'dontAsk', editor: 'acceptEdits' };

/** Project files Claude Code loads by itself (spec §12.2): scrubbed from the job's worktree. */
const SCRUB_PATHS = ['.claude/', '.mcp.json', 'CLAUDE.md'];

/** A progress line is one line of the agent's own text, cut to this length. */
const PROGRESS_MAX = 200;

export type ClaudeCodeOptions = {
  /** Your ANTHROPIC_API_KEY, only when you opted into API billing (`apiBilling`). Otherwise Claude Code uses your login. */
  apiKey?: string;
  /** You opted into API billing (`apiBilling`): then `apiKey` must be set. */
  apiBilling?: boolean;
  /** Runs a program (tests pass a pretend one). */
  run?: RunProgram;
};

/**
 * Claude Code, run headless (`claude -p`) with only the tools its mode allows and Nitpilot's tools over
 * MCP (spec §12.2). Its own settings still apply (your login, ~/.claude/CLAUDE.md), but hooks, slash
 * commands and any MCP server other than Nitpilot's are switched off.
 */
export function claudeCodeAdapter(opts: ClaudeCodeOptions = {}): AgentAdapter {
  const run = opts.run ?? runProgram;
  return {
    id: 'claude-code',
    modes: ['reviewer', 'editor'],
    scrubPaths: SCRUB_PATHS,
    async detect() {
      const version = await run('claude', ['--version']);
      if (version.code !== 0) return { ok: false, problem: '`claude` is not installed (or not on your PATH)' };
      const found = version.stdout.trim();
      if (opts.apiKey) return { ok: true, version: found };
      if (opts.apiBilling) return { ok: false, version: found, problem: 'apiBilling is on, but ANTHROPIC_API_KEY is not set: set it, or turn apiBilling off to use your Claude login' };
      const auth = await run('claude', ['auth', 'status']);
      if (!isLoggedIn(auth.stdout)) return { ok: false, version: found, problem: 'Claude Code is not logged in: run `claude auth login`' };
      return { ok: true, version: found };
    },
    buildInvocation(i) {
      if (!Object.hasOwn(TOOLS, i.mode)) throw new Error(`Claude Code has no ${String(i.mode)} mode`);
      const tools = TOOLS[i.mode];
      const mcpConfig = join(i.tmpDir, 'mcp.json');
      const server = { type: 'http', url: i.mcp.url, headers: { Authorization: `Bearer ${i.mcp.token}` }, alwaysLoad: true };
      const args = [
        '-p', i.prompt,
        '--output-format', 'stream-json',
        '--verbose',
        '--max-turns', String(i.maxTurns),
        '--tools', tools.join(','),
        '--allowedTools', `mcp__${BRAND.mcpServerName}`,
        '--permission-mode', PERMISSION_MODE[i.mode],
        // The token is in this file (0600), never on the command line.
        '--mcp-config', mcpConfig,
        '--strict-mcp-config',
        '--setting-sources', 'user',
        '--settings', JSON.stringify({ disableAllHooks: true }),
        '--disable-slash-commands',
      ];
      if (i.model) args.push('--model', i.model);
      const env = opts.apiKey ? { ...i.baseEnv, ANTHROPIC_API_KEY: opts.apiKey } : i.baseEnv;
      return { command: 'claude', args, env, files: [{ path: mcpConfig, content: JSON.stringify({ mcpServers: { [BRAND.mcpServerName]: server } }) }] };
    },
    parseLine,
    outcome({ code, last, stderrTail }) {
      if (code === 0 && last?.type === 'result' && last.ok) return { ok: true };
      // Only a result that itself failed is read: an ok result is the agent's own words, which may say anything.
      return failure(`${last?.type === 'result' && !last.ok ? last.text : ''}\n${stderrTail}`);
    },
  };
}

/** One line of `--output-format stream-json`. Never throws. */
function parseLine(line: string): AgentEvent | null {
  let event: StreamEvent;
  try {
    event = JSON.parse(line) as StreamEvent;
  } catch {
    return null;
  }
  // `null`, a number or a list is valid JSON too, but not an event.
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return null;
  if (event.type === 'assistant') {
    const content: unknown[] = Array.isArray(event.message?.content) ? event.message.content : [];
    const blocks = content.filter((b): b is ContentBlock => typeof b === 'object' && b !== null);
    const tool = blocks.find((b) => b.type === 'tool_use' && typeof b.name === 'string');
    if (tool) return { type: 'progress', text: `Using ${String(tool.name).replace(`mcp__${BRAND.mcpServerName}__`, '')}` };
    const text = blocks.find((b) => b.type === 'text' && typeof b.text === 'string' && b.text.trim());
    if (text) return { type: 'progress', text: String(text.text).trim().split('\n')[0]!.slice(0, PROGRESS_MAX) };
    return null;
  }
  if (event.type === 'result') {
    const ok = event.subtype === 'success' && event.is_error !== true;
    const message = typeof event.result === 'string' ? event.result : Array.isArray(event.errors) ? event.errors.join('; ') : '';
    // A failed run's subtype and HTTP status lead the text, for outcome() to read.
    const text = ok ? message : [event.subtype, event.api_error_status, message].filter((part) => part !== undefined && part !== null && part !== '').join(': ');
    return { type: 'result', ok, text };
  }
  return null;
}

/**
 * Why a run failed, from a failed result line and stderr. This reads Claude Code's own wording and a failed
 * result's status ("subtype: 429: …" at the start of a line), never the agent's own words. Only a crash is
 * worth trying again at once.
 */
function failure(text: string): AgentOutcome {
  if (/error_max_turns|maximum number of turns/i.test(text)) return { ok: false, reason: 'max_turns', retryable: false };
  if (/^\w+: 429\b|hit your (?:\w+ )*limit/im.test(text)) return { ok: false, reason: 'quota', retryable: false };
  if (/^\w+: 401\b|failed to authenticate|invalid api key|not logged in|please run \/login/im.test(text)) return { ok: false, reason: 'auth', retryable: false };
  return { ok: false, reason: 'crash', retryable: true };
}

function isLoggedIn(statusJson: string): boolean {
  try {
    return (JSON.parse(statusJson) as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    return false;
  }
}

type StreamEvent = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  errors?: unknown;
  api_error_status?: unknown;
  message?: { content?: unknown };
};
type ContentBlock = { type?: unknown; name?: unknown; text?: unknown };
