import { join } from 'node:path';
import { BRAND } from '@nitpilot/protocol';
import { runProgram, type RunProgram } from '../../run-program';
import { agentBaseEnv } from '../runner';
import type { AgentAdapter, AgentEvent, AgentMode, AgentOutcome } from '../types';

/** The Codex CLI version these flags were checked against (spec §12.2). The live conformance suite catches drift. */
export const CODEX_CHECKED_VERSION = '0.166.0';

/**
 * The sandbox per mode. Codex has no tool allowlist: with its shell off, the built-in tools left that touch
 * files are apply_patch (edits) and nothing that reads, so the agent reads the code through Nitpilot's
 * get_file. The sandbox decides whether apply_patch may write: read-only refuses every write (and with
 * approval_policy "never" it can't ask), workspace-write allows the worktree only.
 */
const SANDBOX: Record<AgentMode, string> = { reviewer: 'read-only', editor: 'workspace-write' };

/** Built-in features that would hand the model more than reading and editing (`--disable`): a shell, images from anywhere on disk, subagents, ChatGPT apps, hooks. */
const DISABLED_FEATURES = ['shell_tool', 'view_image', 'multi_agent', 'apps', 'hooks'];

/** Project files Codex loads by itself (spec §12.2): instructions, its project config (MCP servers, hooks, rules) and skills. */
const SCRUB_PATHS = ['AGENTS.md', 'AGENTS.override.md', '.codex/', '.agents/'];

/** A progress line is one line of the agent's own text, cut to this length. */
const PROGRESS_MAX = 200;

export type CodexOptions = {
  /** Your environment (default: this process's). detect() checks Codex with the same allowlisted part a job gets. */
  env?: Record<string, string | undefined>;
  /** Runs a program (tests pass a pretend one). */
  run?: RunProgram;
};

/** A string as a TOML value for `-c key=value` (a JSON string is a valid TOML basic string). */
const toml = (value: string | boolean) => JSON.stringify(value);
/** A path quoted for `sh -c`. */
const shQuote = (path: string) => `'${path.replaceAll("'", `'\\''`)}'`;

/**
 * OpenAI Codex CLI, run headless (`codex exec --json`) with its shell off and Nitpilot's tools over MCP
 * (spec §12.2). It signs in with your stored `codex login` (in CODEX_HOME, ~/.codex by default). Your own
 * config.toml is not loaded (`--ignore-user-config`), so none of your MCP servers, hooks or trusted projects
 * reach a job; neither do the PR's AGENTS.md, .codex/ or rules.
 */
export function codexAdapter(opts: CodexOptions = {}): AgentAdapter {
  const run = opts.run ?? runProgram;
  return {
    id: 'codex',
    modes: ['reviewer', 'editor'],
    scrubPaths: SCRUB_PATHS,
    async detect() {
      // The environment a job gets, not yours: a login found through a variable the agent never sees
      // (CODEX_API_KEY, say) would pass here and fail every job.
      const env = agentBaseEnv(opts.env ?? process.env);
      const version = await run('codex', ['--version'], { env });
      if (version.code !== 0) return { ok: false, problem: '`codex` is not installed (or not on your PATH)' };
      const found = version.stdout.trim().split('\n')[0]!;
      const login = await run('codex', ['login', 'status'], { env });
      if (login.code !== 0) return { ok: false, version: found, problem: 'Codex is not logged in: run `codex login`' };
      return { ok: true, version: found };
    },
    buildInvocation(i) {
      if (!Object.hasOwn(SANDBOX, i.mode)) throw new Error(`Codex CLI has no ${String(i.mode)} mode`);
      const headersFile = join(i.tmpDir, 'mcp-headers.json');
      const server = `mcp_servers.${BRAND.mcpServerName}`;
      const config = [
        `${server}.url=${toml(i.mcp.url)}`,
        // Codex runs this (sh -c) and sends the JSON it prints as headers: the token stays in the 0600 file, never on the command line.
        `${server}.http_headers_helper=${toml(`/bin/cat ${shQuote(headersFile)}`)}`,
        `${server}.default_tools_approval_mode=${toml('approve')}`,
        `${server}.required=true`,
        `approval_policy=${toml('never')}`,
        `web_search=${toml('disabled')}`,
        // No AGENTS.md from the PR (the scrub is the first lock), no writes to the temp folders, no network.
        'project_doc_max_bytes=0',
        'sandbox_workspace_write.exclude_tmpdir_env_var=true',
        'sandbox_workspace_write.exclude_slash_tmp=true',
        'sandbox_workspace_write.network_access=false',
      ];
      const args = [
        'exec',
        '--json',
        '--color', 'never',
        '--ephemeral',
        '--skip-git-repo-check',
        '--ignore-user-config',
        '--ignore-rules',
        '--sandbox', SANDBOX[i.mode],
        ...DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
        ...config.flatMap((c) => ['-c', c]),
      ];
      if (i.model) args.push('--model', i.model);
      // Codex has no max-turns setting: the job timeout covers a runaway run.
      args.push('--', i.prompt);
      return { command: 'codex', args, env: i.baseEnv, files: [{ path: headersFile, content: JSON.stringify({ Authorization: `Bearer ${i.mcp.token}` }) }] };
    },
    parseLine,
    outcome({ code, last, stderrTail }) {
      if (code === 0 && last?.type === 'result' && last.ok) return { ok: true };
      // Only a failed result is read: it's Codex's own error message, never the agent's words.
      return failure(`${last?.type === 'result' && !last.ok ? last.text : ''}\n${stderrTail}`);
    },
  };
}

/** One line of `codex exec --json` (JSONL). Never throws. */
function parseLine(line: string): AgentEvent | null {
  let event: CodexEvent;
  try {
    event = JSON.parse(line) as CodexEvent;
  } catch {
    return null;
  }
  // `null`, a number or a list is valid JSON too, but not an event.
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return null;
  const item = typeof event.item === 'object' && event.item !== null ? event.item : {};
  if (event.type === 'item.started' && item.type === 'mcp_tool_call' && typeof item.tool === 'string') return { type: 'progress', text: `Using ${item.tool}` };
  if (event.type === 'item.completed' && item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
    return { type: 'progress', text: item.text.trim().split('\n')[0]!.slice(0, PROGRESS_MAX) };
  }
  if (event.type === 'turn.completed') return { type: 'result', ok: true, text: '' };
  // A later turn.completed replaces an error Codex retried past.
  if (event.type === 'turn.failed') return { type: 'result', ok: false, text: typeof event.error?.message === 'string' ? event.error.message : 'turn failed' };
  if (event.type === 'error') return { type: 'result', ok: false, text: typeof event.message === 'string' ? event.message : 'error' };
  return null;
}

/**
 * Why a run failed, from Codex's error message and stderr. Only a crash is worth trying again at once.
 * The 401 wording was recorded logged out. shortcut: the quota wording is from Codex's source (protocol/src/error.rs),
 * not a recorded run; replace it with the real text the first time a run hits one.
 */
function failure(text: string): AgentOutcome {
  if (/hit your (?:usage limit|spend cap)|quota exceeded|rate limit exceeded|unexpected status 429\b/i.test(text)) return { ok: false, reason: 'quota', retryable: false };
  if (/unexpected status 401\b|not logged in|refresh token|log ?in again|sign in again/i.test(text)) return { ok: false, reason: 'auth', retryable: false };
  return { ok: false, reason: 'crash', retryable: true };
}

type CodexEvent = { type?: string; message?: unknown; error?: { message?: unknown }; item?: { type?: unknown; tool?: unknown; text?: unknown } };
