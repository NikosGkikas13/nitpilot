import type { FailureReason } from '@nitpilot/protocol';

/**
 * A job that can't go on, and why, in the protocol's words (spec §10 `job.fail`). The executor
 * (Task 17) turns it into `job.fail { reason, retryable, detail }`; the engine's retry rules decide the rest.
 */
export class JobFailure extends Error {
  constructor(
    readonly reason: FailureReason,
    readonly retryable: boolean,
    detail: string,
  ) {
    super(detail);
    this.name = 'JobFailure';
  }
}
