import type { Dispatcher } from '../chats/dispatch';
import { JobAssigner } from '../jobs/assign';
import { buildJobBundle } from '../jobs/bundle';
import type { PlatformReads } from '../platform/types';
import type { CliHub } from './cli-hub';

/** How often the timers run: jobs whose retry delay ended. */
export const SWEEP_MS = 5_000;

export type CliHubDeps = {
  hub: CliHub;
  dispatcher: Dispatcher;
  platform: Pick<PlatformReads, 'gitSpec'>;
  now?: () => Date;
};

/**
 * Connect the CLI hub to the rest of the server: who gets which job, and when. main.ts and the
 * tests both call this, so the tests run exactly the wiring production runs.
 */
export function wireCliHub({ hub, dispatcher, platform, now = () => new Date() }: CliHubDeps) {
  const assigner = new JobAssigner(hub, (jobId) => buildJobBundle(jobId, platform), now);

  hub.onMessage(async (_conn, msg) => {
    // A CLI that just said hello may be able to take queued jobs.
    if (msg.t === 'hello') assigner.wake();
  });

  dispatcher.onCommit((_chatId, effects) => {
    // A job was queued, finished, failed or cancelled: maybe another one can go out now.
    if (effects.jobsChanged) assigner.wake();
  });

  assigner.onBundleFailed(async (job) => {
    // The job is ours but can't be sent. Let the engine's retry rules decide now, instead of
    // waiting for its lease to run out and calling it a timeout (spec §9.4).
    await dispatcher.dispatch(job.chatId, { type: 'job_failed', jobId: job.jobId, reason: 'setup_failed', retryable: true });
  });

  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    assigner,
    start(): void {
      timer ??= setInterval(() => assigner.wake(), SWEEP_MS);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
