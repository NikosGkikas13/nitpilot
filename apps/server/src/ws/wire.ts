import type { Dispatcher } from '../chats/dispatch';
import { JobAssigner } from '../jobs/assign';
import { bundleFor } from '../jobs/bundle';
import { CatchUp } from '../jobs/catch-up';
import { cancelMessage, Leases } from '../jobs/leases';
import type { PlatformReads } from '../platform/types';
import type { CliHub } from './cli-hub';
import { jobMessageHandler } from './handlers';

/** How often the timers run: jobs whose retry delay ended, and leases that ran out. */
export const SWEEP_MS = 5_000;

export type CliHubDeps = {
  hub: CliHub;
  dispatcher: Dispatcher;
  platform: PlatformReads;
  now?: () => Date;
};

/**
 * Connect the CLI hub to the rest of the server: who gets which job, and what CLIs' messages do.
 * main.ts and the tests both call this, so the tests run exactly the wiring production runs.
 */
export function wireCliHub({ hub, dispatcher, platform, now = () => new Date() }: CliHubDeps) {
  const assigner = new JobAssigner(hub, (jobId, type) => bundleFor(jobId, type, platform), now);
  const leases = new Leases(hub, dispatcher.dispatch, now);
  const catchUp = new CatchUp({ platform, dispatch: dispatcher.dispatch });

  // Every message from a CLI goes through these listeners, in this order.
  hub.onMessage(leases.handle); // hello and ping: renew leases, cancel what's no longer theirs
  hub.onMessage(jobMessageHandler({ dispatch: dispatcher.dispatch, platform })); // pushes, results, failures, refusals
  hub.onMessage(async (conn, msg) => {
    if (msg.t !== 'hello') return;
    // A CLI that just said hello may be able to take queued jobs.
    assigner.wake();
    // The first hello since the server started: look for PRs of theirs we missed (spec §15). Not awaited,
    // so this CLI's next messages don't wait for GitHub's search; the jobs it queues wake the assigner.
    void catchUp.forUser({ id: conn.userId, login: conn.login }).catch((err) => console.error(`[catch-up] ${conn.login}:`, err));
  });

  dispatcher.onCommit((_chatId, effects) => {
    // A job was queued, finished, failed or cancelled: maybe another one can go out now.
    if (effects.jobsChanged) assigner.wake();
    // Jobs the engine cancelled while a CLI was running them (PR closed, reviewer removed, a human push).
    for (const job of effects.cancelledJobs) {
      if (job.cliTokenId) hub.send(job.cliTokenId, cancelMessage({ jobId: job.id, attempt: job.attempt }, job.reason));
    }
  });

  assigner.onBundleFailed(async (job) => {
    // The job is ours but can't be sent. Let the engine's retry rules decide now, instead of
    // waiting for its lease to run out and calling it a timeout (spec §9.4).
    await dispatcher.dispatch(job.chatId, { type: 'job_failed', jobId: job.jobId, reason: 'setup_failed', retryable: true, attempt: job.attempt });
  });

  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    assigner,
    leases,
    catchUp,
    start(): void {
      timer ??= setInterval(() => {
        assigner.wake();
        void leases.sweep().catch((err) => console.error('[leases] sweep failed:', err));
      }, SWEEP_MS);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
