import type { PlatformWrites } from '../platform/types';
import { recoverRunningTasks } from '../tasks/runner';
import type { Ingest } from './process';

const REDELIVER_WINDOW_MS = 3 * 86_400_000;

/** Pick up where a crashed or restarted server left off (spec §15 "Recovering after a restart"). */
export async function recoverOnBoot(deps: { ingest: Ingest; platform: PlatformWrites; now?: Date }): Promise<{ tasks: number; replayed: number; redelivered: number }> {
  const now = deps.now ?? new Date();
  const tasks = await recoverRunningTasks();
  const replayed = await deps.ingest.replayReceived();
  let redelivered = 0;
  try {
    redelivered = (await deps.platform.redeliverFailed?.(new Date(now.getTime() - REDELIVER_WINDOW_MS))) ?? 0;
  } catch (err) {
    console.warn('[recovery] could not ask GitHub for failed deliveries; continuing', err);
  }
  return { tasks, replayed, redelivered };
}
