import type { AgentId, AgentMode } from '@nitpilot/protocol';

export type { AgentMode };

/** A line of an agent's output that means something to Nitpilot: live status, or how the run ended. */
export type AgentEvent = { type: 'progress'; text: string } | { type: 'result'; ok: boolean; text: string };

/** What an adapter needs to build the command for one job (spec §12.2). */
export type InvocationInput = {
  mode: AgentMode;
  /** The job's worktree: the agent runs there. */
  cwd: string;
  prompt: string;
  /** Where the job's tools are, and its token (spec §11 "Local MCP server"). */
  mcp: { url: string; token: string };
  /** A private folder for this run (0700), deleted afterwards: config files with the token go here. */
  tmpDir: string;
  /** The environment the agent may see: an allowlist, no tokens (agentBaseEnv). */
  baseEnv: Record<string, string>;
  model?: string;
  maxTurns: number;
};

/** The command to run. `files` are written (0600) before it starts. */
export type AgentInvocation = { command: string; args: string[]; env: Record<string, string>; files: { path: string; content: string }[] };

export type AgentFailure = 'auth' | 'quota' | 'max_turns' | 'crash' | 'timeout' | 'no_result';
export type AgentOutcome = { ok: true } | { ok: false; reason: AgentFailure; retryable: boolean };

/**
 * One agent CLI, as Nitpilot drives it (spec §12.2). An adapter only builds the command and reads its
 * output, so it can be tested without running anything; runAgent (runner.ts) does the running.
 */
export interface AgentAdapter {
  readonly id: AgentId;
  /** Only modes that pass the conformance suite (spec §12.3). */
  readonly modes: readonly AgentMode[];
  /** Project files this agent loads by itself: they're scrubbed from the job's worktree. */
  readonly scrubPaths: readonly string[];
  /** Is it installed (and logged in)? */
  detect(): Promise<{ ok: boolean; version?: string; problem?: string }>;
  /** Throws for a mode the adapter doesn't support. */
  buildInvocation(i: InvocationInput): AgentInvocation;
  /** Never throws. Null for lines that mean nothing to Nitpilot. */
  parseLine(line: string): AgentEvent | null;
  outcome(i: { code: number | null; signal: string | null; last?: AgentEvent; stderrTail: string }): AgentOutcome;
}
