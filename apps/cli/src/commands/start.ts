import { BRAND } from '@nitpilot/protocol';
import { adapterFor } from '../agents/registry';
import type { AgentAdapter } from '../agents/types';
import { configDir, loadConfig } from '../config/config';
import { startDaemon, type Daemon, type DaemonOptions, type JobExecutor } from '../daemon';
import { CliError } from '../errors';
import { startMcpServer, type LocalMcpServer } from '../mcp/server';
import { terminal, type Out } from '../out';
import { createExecutor } from '../runner/execute';
import { emptyHooksDir } from '../runner/safe-git';
import { cleanUpWorktrees } from '../runner/worktree';

export type StartDeps = {
  env?: Record<string, string | undefined>;
  out?: Out;
  /** Stops the daemon, like Ctrl-C (tests). */
  stop?: AbortSignal;
  /** The agent to run, instead of the one the config names (tests run the fake agent with their own scenario). Null: none. */
  adapter?: AgentAdapter | null;
};

/** An agent that isn't wired in yet (M11 adds Claude Code and Gemini CLI): the daemon declares no modes, so the server sends it no jobs. */
const noAgentYet: JobExecutor = async () => ({ kind: 'reject', reason: 'unsupported_mode' });

/**
 * `nitpilot start` (spec §11): clean up what a crash left behind, start the local MCP server, then stay
 * connected and run jobs until Ctrl-C. Exits with 1 when the server sends it away.
 */
export async function start(deps: StartDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? terminal;
  const dir = configDir(env);
  const config = loadConfig({ env, dir });
  if (!config.token) throw new CliError(`Not logged in. Run \`${BRAND.cli} login\` first.`);

  const adapter = deps.adapter !== undefined ? deps.adapter : adapterFor(config, env);
  let agent: DaemonOptions['agent'] = { id: config.agent, version: null, modes: [] };
  let executor = noAgentYet;
  let mcp: LocalMcpServer | null = null;
  if (adapter) {
    const found = await adapter.detect();
    if (!found.ok) throw new CliError(`${adapter.id} isn't ready: ${found.problem ?? 'unknown problem'} Run \`${BRAND.cli} doctor\`.`);
    // Worktrees a crash left behind go first, before any new job can start (spec §11 step 8).
    await cleanUpWorktrees({ configDir: dir, repoPaths: Object.values(config.repos).map((repo) => repo.path), hooksDir: emptyHooksDir(dir), env });
    mcp = await startMcpServer({ onError: (err) => out.error(`[mcp] ${err.message}`) });
    agent = { id: adapter.id, version: found.version ?? null, modes: [...adapter.modes] };
    executor = createExecutor({ config, configDir: dir, mcp, adapter, env });
  } else {
    out.log(`${config.agent} isn't wired in yet: this device shows notifications, but takes no jobs.`);
  }

  // The first Ctrl-C stops cleanly. The listener is gone after it, so a second one quits at once.
  let daemon: Daemon | undefined;
  const stop = () => daemon?.stop();
  try {
    daemon = startDaemon({ config, configDir: dir, out, agent, executor });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    deps.stop?.addEventListener('abort', stop, { once: true });
    if (deps.stop?.aborted) stop(); // told to stop before we got here: an abort event never fires twice
    const reason = await daemon.stopped;
    return reason === 'stopped' ? 0 : 1;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    deps.stop?.removeEventListener('abort', stop);
    await mcp?.close();
  }
}
