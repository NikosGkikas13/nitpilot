import { join } from 'node:path';
import { BRAND } from '@nitpilot/protocol';
import { runProgram, type RunProgram } from '../../run-program';
import { agentBaseEnv } from '../runner';
import type { AgentAdapter, AgentEvent, AgentMode, AgentOutcome } from '../types';

/** The Copilot CLI version these flags were checked against (spec §12.2). The live conformance suite catches drift. */
export const COPILOT_CHECKED_VERSION = '1.0.105';

/**
 * Built-in tools per mode (spec §12.3 S1), passed to --available-tools so the model can't see anything else
 * (no bash, web_fetch, task, sql, skill …). The names depend on the model: GPT models get rg and apply_patch,
 * others grep, edit and create, so each mode lists every variant.
 */
const TOOLS: Record<AgentMode, readonly string[]> = {
  reviewer: ['view', 'grep', 'rg', 'glob'],
  editor: ['view', 'grep', 'rg', 'glob', 'edit', 'create', 'apply_patch'],
};
/** What runs without asking. In -p mode anything else is refused, never asked about. `write` stays inside the worktree. */
const ALLOWED: Record<AgentMode, readonly string[]> = {
  reviewer: [BRAND.mcpServerName],
  editor: [BRAND.mcpServerName, 'write'],
};

/**
 * Project files Copilot CLI loads by itself (spec §12.2; runner/scrub.ts scrubs every agent's), scrubbed from
 * the job's worktree. --no-custom-instructions and no --trust-folder already keep them out; this is the
 * second lock.
 */
const SCRUB_PATHS = [
  '.copilot/', '.github/copilot-instructions.md', '.github/instructions/', '.github/agents/', '.github/skills/', '.github/prompts/', '.github/hooks/',
  '.github/mcp.json', '.vscode/mcp.json', '.mcp.json', 'AGENTS.md', 'CLAUDE.md',
];

/** A progress line is one line of the agent's own text, cut to this length. */
const PROGRESS_MAX = 200;

export type CopilotOptions = {
  /** Your environment (default: this process's). detect() checks Copilot with the same allowlisted part a job gets. */
  env?: Record<string, string | undefined>;
  /** Runs a program (tests pass a pretend one). */
  run?: RunProgram;
};

/**
 * GitHub Copilot CLI, run headless (`copilot -p`) with only the tools its mode allows and Nitpilot's tools
 * over MCP (spec §12.2). It signs in with your stored `copilot login`. The PR's own instructions, MCP
 * servers and hooks are never loaded: no --trust-folder, --no-custom-instructions, built-in servers off.
 */
export function copilotAdapter(opts: CopilotOptions = {}): AgentAdapter {
  const run = opts.run ?? runProgram;
  return {
    id: 'copilot',
    modes: ['reviewer', 'editor'],
    scrubPaths: SCRUB_PATHS,
    async detect() {
      const env = agentBaseEnv(opts.env ?? process.env);
      const version = await run('copilot', ['--version'], { env });
      if (version.code !== 0) return { ok: false, problem: '`copilot` is not installed (or not on your PATH)' };
      // shortcut: Copilot CLI has no login-status command, so a missing login shows up as the first job's `auth` failure; check here once it has one.
      return { ok: true, version: version.stdout.trim().split('\n')[0]! };
    },
    buildInvocation(i) {
      if (!Object.hasOwn(TOOLS, i.mode)) throw new Error(`Copilot CLI has no ${String(i.mode)} mode`);
      const mcpConfig = join(i.tmpDir, 'mcp.json');
      const server = { type: 'http', url: i.mcp.url, headers: { Authorization: `Bearer ${i.mcp.token}` }, tools: ['*'] };
      const args = [
        '-p', i.prompt,
        '--output-format', 'json',
        '--no-auto-update',
        '--no-color',
        '--no-ask-user',
        '--no-custom-instructions',
        '--disable-builtin-mcps',
        '--disallow-temp-dir',
        '--available-tools', ...TOOLS[i.mode], BRAND.mcpServerName,
        '--allow-tool', ...ALLOWED[i.mode],
        // `write` alone would let an editor repoint the worktree's .git file; deny rules win over allow rules.
        '--deny-tool', 'write(.git)',
        // The token is in this file (0600), never on the command line.
        '--additional-mcp-config', `@${mcpConfig}`,
      ];
      if (i.model) args.push('--model', i.model);
      return { command: 'copilot', args, env: i.baseEnv, files: [{ path: mcpConfig, content: JSON.stringify({ mcpServers: { [BRAND.mcpServerName]: server } }) }] };
    },
    parseLine,
    outcome({ code, last, stderrTail }) {
      // Only the exit code counts: on SIGTERM Copilot still writes a `result` line with exitCode 0.
      if (code === 0 && last?.type === 'result' && last.ok) return { ok: true };
      return failure(stderrTail);
    },
  };
}

/** One line of `--output-format json`. Never throws. */
function parseLine(line: string): AgentEvent | null {
  let event: CopilotEvent;
  try {
    event = JSON.parse(line) as CopilotEvent;
  } catch {
    return null;
  }
  // `null`, a number or a list is valid JSON too, but not an event.
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return null;
  if (event.type === 'assistant.message') {
    const requests: unknown[] = Array.isArray(event.data?.toolRequests) ? event.data.toolRequests : [];
    const tool = requests.find((r): r is { name: string } => typeof r === 'object' && r !== null && typeof (r as { name?: unknown }).name === 'string');
    if (tool) return { type: 'progress', text: `Using ${tool.name.replace(`${BRAND.mcpServerName}-`, '')}` };
    const content = event.data?.content;
    if (typeof content === 'string' && content.trim()) return { type: 'progress', text: content.trim().split('\n')[0]!.slice(0, PROGRESS_MAX) };
    return null;
  }
  if (event.type === 'result') {
    const ok = event.exitCode === 0;
    return { type: 'result', ok, text: ok ? '' : `exit code ${String(event.exitCode)}` };
  }
  return null;
}

/**
 * Why a run failed, from Copilot's own `Error: …` lines on stderr, never the agent's words. Only a crash is
 * worth trying again at once.
 * shortcut: the auth and quota wording is written from the docs, not recorded (a login or plan limit can't be
 * reached on purpose here); replace it with the real text the first time a run hits one.
 */
function failure(stderr: string): AgentOutcome {
  if (/^Error: .*(?:quota|rate limit|reached your .*limit|exceeded your .*(?:limit|credits)|out of (?:ai )?credits|\b429\b)/im.test(stderr)) return { ok: false, reason: 'quota', retryable: false };
  if (/^Error: .*(?:no authentication information|bad credentials|not authorized to use copilot|copilot (?:cli )?(?:is )?(?:disabled|not enabled)|\b401\b)/im.test(stderr)) return { ok: false, reason: 'auth', retryable: false };
  return { ok: false, reason: 'crash', retryable: true };
}

type CopilotEvent = { type?: string; exitCode?: unknown; data?: { content?: unknown; toolRequests?: unknown } };
