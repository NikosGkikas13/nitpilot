import { join } from 'node:path';
import { BRAND } from '@nitpilot/protocol';
import { runProgram, type RunProgram } from '../../run-program';
import { agentBaseEnv } from '../runner';
import type { AgentAdapter, AgentEvent, AgentMode, AgentOutcome } from '../types';

/** The Gemini CLI version these flags and settings were checked against (spec §12.2). The live conformance suite catches drift. */
export const GEMINI_CLI_CHECKED_VERSION = '0.66.0';

/** Built-in tools per mode (spec §12.3 S1): a reviewer reads, an editor also edits. No shell, no web, no subagents. */
const TOOLS: Record<AgentMode, readonly string[]> = {
  reviewer: ['read_file', 'read_many_files', 'list_directory', 'glob', 'grep_search'],
  editor: ['read_file', 'read_many_files', 'list_directory', 'glob', 'grep_search', 'replace', 'write_file'],
};
/** Refused above every allow rule, so a later Gemini CLI default can't turn them back on. */
const DENIED_TOOLS = ['run_shell_command', 'web_fetch', 'google_web_search'];
/** default: anything that needs approval is refused (headless, nobody can answer). auto_edit: edits inside the worktree go through. */
const APPROVAL_MODE: Record<AgentMode, string> = { reviewer: 'default', editor: 'auto_edit' };

/** Project files Gemini CLI loads by itself (spec §12.2): settings, commands, agents and skills in `.gemini/`, skills in `.agents/`, GEMINI.md, `.env`. */
const SCRUB_PATHS = ['.gemini/', '.agents/', 'GEMINI.md', '.env'];

export type GeminiCliOptions = {
  /** Your GEMINI_API_KEY, only when you opted into API billing (`apiBilling`). Google refuses its login for tools like this one, so a key is required. */
  apiKey?: string;
  /** You opted into API billing (`apiBilling`): then `apiKey` must be set. */
  apiBilling?: boolean;
  /** Your environment (default: this process's). detect() checks Gemini CLI with the same allowlisted part a job gets. */
  env?: Record<string, string | undefined>;
  /** Runs a program (tests pass a pretend one). */
  run?: RunProgram;
};

/**
 * Gemini CLI, run headless (`gemini -p`) with only the tools its mode allows and Nitpilot's tools over MCP
 * (spec §12.2). It bills your Gemini API key (Google AI Studio): Google no longer lets a personal Google login
 * drive Gemini CLI from a tool like this, so the key, and `apiBilling`, are required.
 *
 * The job's private folder is its home (`GEMINI_CLI_HOME`), so the only user settings and policies it reads are
 * ours, and your own `~/.gemini` (settings, MCP servers, extensions, GEMINI.md) and `~/.env` are never read.
 * Our policy file refuses every tool but the mode's own and Nitpilot's. (A system settings file would outrank
 * these, but Gemini CLI ignores one that isn't owned by root.)
 */
export function geminiCliAdapter(opts: GeminiCliOptions = {}): AgentAdapter {
  const run = opts.run ?? runProgram;
  return {
    id: 'gemini-cli',
    modes: ['reviewer', 'editor'],
    scrubPaths: SCRUB_PATHS,
    async detect() {
      // The environment a job gets, not yours (see the Claude Code adapter).
      const env = agentBaseEnv(opts.env ?? process.env);
      const version = await run('gemini', ['--version'], { env });
      if (version.code !== 0) return { ok: false, problem: '`gemini` is not installed (or not on your PATH)' };
      const found = version.stdout.trim();
      if (!opts.apiBilling) return { ok: false, version: found, problem: 'Gemini CLI bills your own API key: turn apiBilling on in the config and set GEMINI_API_KEY' };
      if (!opts.apiKey) return { ok: false, version: found, problem: 'apiBilling is on, but GEMINI_API_KEY is not set: set it to your Google AI Studio key' };
      return { ok: true, version: found };
    },
    buildInvocation(i) {
      if (!Object.hasOwn(TOOLS, i.mode)) throw new Error(`Gemini CLI has no ${String(i.mode)} mode`);
      const settingsPath = join(i.tmpDir, '.gemini', 'settings.json');
      const policyPath = join(i.tmpDir, 'policy.toml');
      const settings = {
        mcpServers: { [BRAND.mcpServerName]: { httpUrl: i.mcp.url, headers: { Authorization: `Bearer ${i.mcp.token}` }, trust: true } },
        tools: { core: TOOLS[i.mode] },
        hooksConfig: { enabled: false },
        experimental: { enableAgents: false },
        // The worktree's .env is scrubbed; this also skips one in a folder above it.
        advanced: { ignoreLocalEnv: true },
        model: { maxSessionTurns: i.maxTurns },
        security: { auth: { selectedType: 'gemini-api-key' } },
      };
      const args = [
        '-p', i.prompt,
        '-o', 'stream-json',
        // Headless, an untrusted folder exits (or connects no MCP server), so the job's folder is trusted; the scrub keeps its .gemini/ out.
        '--skip-trust',
        '-e', 'none',
        '--allowed-mcp-server-names', BRAND.mcpServerName,
        '--approval-mode', APPROVAL_MODE[i.mode],
        '--policy', policyPath,
      ];
      if (i.model) args.push('-m', i.model);
      // The settings file holds the token (0600), never the command line or the environment.
      const env = { ...i.baseEnv, GEMINI_CLI_HOME: i.tmpDir, ...(opts.apiKey ? { GEMINI_API_KEY: opts.apiKey } : {}) };
      return {
        command: 'gemini',
        args,
        env,
        files: [
          { path: settingsPath, content: JSON.stringify(settings) },
          { path: policyPath, content: policyToml(i.mode) },
        ],
      };
    },
    parseLine,
    outcome({ code, last, stderrTail }) {
      if (code === 0 && last?.type === 'result' && last.ok) return { ok: true };
      // Only a result that itself failed is read: an ok result is the agent's own words, which may say anything.
      return failure(`${last?.type === 'result' && !last.ok ? last.text : ''}\n${stderrTail}`);
    },
  };
}

/**
 * Gemini CLI's policy file (its policy engine; the highest rule that matches wins): every tool is refused, then
 * the mode's own tools and Nitpilot's MCP server are allowed, and the shell and the web refused above all of it.
 * Gemini CLI only warns about a policy file it can't read (and runs on), so the settings' tools.core allowlist stays too.
 */
function policyToml(mode: AgentMode): string {
  const rule = (lines: string[]) => `[[rule]]\n${lines.join('\n')}\n`;
  const list = (names: readonly string[]) => `[${names.map((name) => JSON.stringify(name)).join(', ')}]`;
  return [
    rule(['toolName = "*"', 'decision = "deny"', 'priority = 1']),
    rule([`toolName = ${list(TOOLS[mode])}`, 'decision = "allow"', 'priority = 900']),
    // 0.63 needs a toolName next to mcpName.
    rule([`mcpName = ${JSON.stringify(BRAND.mcpServerName)}`, 'toolName = "*"', 'decision = "allow"', 'priority = 900']),
    rule([`toolName = ${list(DENIED_TOOLS)}`, 'decision = "deny"', 'priority = 999']),
  ].join('\n');
}

/**
 * One line of `-o stream-json` (JSONL). Never throws. Progress comes from tool calls only: Gemini CLI streams
 * its own words in small pieces (`delta`), which would make half-sentence status lines.
 */
function parseLine(line: string): AgentEvent | null {
  let event: StreamEvent;
  try {
    event = JSON.parse(line) as StreamEvent;
  } catch {
    return null;
  }
  // `null`, a number or a list is valid JSON too, but not an event.
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return null;
  if (event.type === 'tool_use' && typeof event.tool_name === 'string') {
    // MCP tools are named mcp_<server>_<tool>.
    return { type: 'progress', text: `Using ${event.tool_name.replace(`mcp_${BRAND.mcpServerName}_`, '')}` };
  }
  if (event.type === 'result') {
    if (event.status === 'success') return { type: 'result', ok: true, text: '' };
    const error = typeof event.error === 'object' && event.error !== null ? (event.error as { type?: unknown; message?: unknown }) : {};
    const text = [error.type, error.message].filter((part): part is string => typeof part === 'string' && part !== '').join(': ');
    return { type: 'result', ok: false, text };
  }
  return null;
}

/**
 * Why a run failed, from a failed result line and stderr. This reads Gemini CLI's own error type and the
 * API's wording (`RESOURCE_EXHAUSTED`, `"code": 429`), never the agent's own words. Only a crash is worth
 * trying again at once. The invalid-key, missing-key and free-tier daily-quota wordings were recorded.
 */
function failure(text: string): AgentOutcome {
  if (/FatalTurnLimitedError|max session turns/i.test(text)) return { ok: false, reason: 'max_turns', retryable: false };
  if (/RESOURCE_EXHAUSTED|exceeded your current quota|exhausted your daily quota|TerminalQuotaError|"code":\s*429\b/i.test(text)) return { ok: false, reason: 'quota', retryable: false };
  if (/API_KEY_INVALID|API key not valid|UNAUTHENTICATED|PERMISSION_DENIED|FatalAuthenticationError|"code":\s*(?:401|403)\b|Please set an Auth method|must specify the GEMINI_API_KEY/i.test(text)) {
    return { ok: false, reason: 'auth', retryable: false };
  }
  return { ok: false, reason: 'crash', retryable: true };
}

type StreamEvent = { type?: string; tool_name?: unknown; status?: unknown; error?: unknown };
