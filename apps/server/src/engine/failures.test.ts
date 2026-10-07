import { describe, expect, it } from 'vitest';
import { T0, agentToAgent, commandsOf, jobOf, leo, run } from './test-builders';
import type { FailureReason } from '@nitpilot/protocol';

function failing(attempt: number, reason: FailureReason, retryable: boolean) {
  const chat = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { attempt })] });
  return run(chat, { type: 'job_failed', jobId: 'job-r1', reason, retryable });
}

const after = (ms: number) => new Date(T0.getTime() + ms);

describe('job_failed', () => {
  it.each([
    [1, 30_000],
    [2, 60_000],
  ])('retries a retryable failure on attempt %i after %i ms', (attempt, delay) => {
    const out = failing(attempt, 'crash', true);
    expect(commandsOf(out, 'retry_job')).toEqual([{ type: 'retry_job', jobId: 'job-r1', runAfter: after(delay), refundAttempt: false }]);
    expect(out.chat.jobs[0]!.status).toBe('queued');
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('none');
  });

  it('gives up after the third attempt and tells the owner', () => {
    const out = failing(3, 'crash', true);
    expect(commandsOf(out, 'fail_job')).toEqual([{ type: 'fail_job', jobId: 'job-r1', reason: 'crash' }]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('failed');
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-leo'], kind: 'failed', pointNumbers: [] }]);
  });

  it('gives up at once on a failure that is not retryable', () => {
    const out = failing(1, 'auth', false);
    expect(commandsOf(out, 'fail_job')).toHaveLength(1);
  });

  it.each([
    ['quota', 15 * 60_000],
    ['daily_cap', 60 * 60_000],
    ['repo_not_linked', 10 * 60_000],
  ] as const)('waits after %s without counting an attempt', (reason, delay) => {
    const out = failing(3, reason, true);
    expect(commandsOf(out, 'retry_job')).toEqual([{ type: 'retry_job', jobId: 'job-r1', runAfter: after(delay), refundAttempt: true }]);
  });

  it.each(['stale_head', 'branch_moved'] as const)('runs again right away after %s', (reason) => {
    const out = failing(2, reason, false);
    expect(commandsOf(out, 'retry_job')).toEqual([{ type: 'retry_job', jobId: 'job-r1', runAfter: T0, refundAttempt: true }]);
  });

  it('ignores a failure from a job that is no longer running', () => {
    const chat = agentToAgent({ jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { status: 'cancelled' })] });
    const out = run(chat, { type: 'job_failed', jobId: 'job-r1', reason: 'crash', retryable: true });
    expect(out.commands).toEqual([]);
  });
});
