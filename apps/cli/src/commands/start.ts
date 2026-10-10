import { BRAND } from '@nitpilot/protocol';
import { configDir, loadConfig } from '../config/config';
import { startDaemon, type JobExecutor } from '../daemon';
import { CliError } from '../errors';
import { terminal, type Out } from '../out';

export type StartDeps = { env?: Record<string, string | undefined>; out?: Out };

/**
 * No agent adapter exists until Plan 1b Task 16, so the daemon declares no agent modes and the server
 * hands it no jobs. One that arrives anyway is turned down. Task 17 replaces this with the real executor.
 */
const noAgentYet: JobExecutor = async () => ({ kind: 'reject', reason: 'unsupported_mode' });

/** `nitpilot start` (spec §11): stay connected and run jobs until Ctrl-C. Exits with 1 when the server sends it away. */
export async function start(deps: StartDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? terminal;
  const dir = configDir(env);
  const config = loadConfig({ env, dir });
  if (!config.token) throw new CliError(`Not logged in. Run \`${BRAND.cli} login\` first.`);
  out.log('Agents are not wired in yet: this device shows notifications, but takes no jobs.');

  const daemon = startDaemon({ config, configDir: dir, out, agent: { id: config.agent, version: null, modes: [] }, executor: noAgentYet });
  // The first Ctrl-C stops cleanly. The listener is gone after it, so a second one quits at once.
  const stop = () => daemon.stop();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const reason = await daemon.stopped;
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  return reason === 'stopped' ? 0 : 1;
}
