import { z } from 'zod';
import { message } from './envelope';
import { AgentId, AgentMode, FailureReason, NotifyKind } from './enums';
import { JobBundle } from './job-bundle';
import { JobResult } from './job-result';

/** Every job message carries (jobId, attempt), so answers from an old attempt can be spotted. */
export const RunningJob = z.object({ jobId: z.string().min(1), attempt: z.number().int().positive() });
export type RunningJob = z.infer<typeof RunningJob>;

// ── CLI → server ──────────────────────────────────────────────

export const Hello = message('hello', z.object({
  protocol: z.number().int(),
  cliVersion: z.string(),
  device: z.string().min(1).max(100),
  agent: z.object({ id: AgentId, version: z.string().nullable(), modes: z.array(AgentMode) }),
  /** Repos linked on this machine, as `owner/name`. */
  repos: z.array(z.string()),
  concurrency: z.number().int().min(1).max(4),
  /** Jobs this CLI is still running, e.g. after the laptop slept. */
  running: z.array(RunningJob),
  defaults: z.object({ autoReview: z.boolean(), autoAddress: z.boolean() }),
}));

export const Ping = message('ping', z.object({ running: z.array(RunningJob) }));

export const JobProgress = message('job.progress', RunningJob.extend({
  stage: z.enum(['preparing', 'running_agent', 'pushing', 'finishing']),
  text: z.string().max(200),
}));

/** Sent before `git push` and acknowledged first, so the server recognizes its own push. */
export const JobPushing = message('job.pushing', RunningJob.extend({ from: z.string(), to: z.string() }));

export const JobComplete = message('job.complete', RunningJob.extend({ result: JobResult }));

export const JobFail = message('job.fail', RunningJob.extend({
  reason: FailureReason,
  retryable: z.boolean(),
  detail: z.string().max(2000),
}));

export const JobReject = message('job.reject', RunningJob.extend({ reason: FailureReason }));

export const CliToServer = z.discriminatedUnion('t', [Hello, Ping, JobProgress, JobPushing, JobComplete, JobFail, JobReject]);
export type CliToServer = z.infer<typeof CliToServer>;

// ── server → CLI ──────────────────────────────────────────────

export const Welcome = message('welcome', z.object({
  login: z.string(),
  pingSec: z.number().int().positive(),
  leaseSec: z.number().int().positive(),
}));

export const Pong = message('pong', z.object({}));

/** The answer to job.pushing / job.complete / job.fail / job.reject. `stale` means "old attempt, ignored". */
export const Ack = message('ack', z.object({ status: z.enum(['applied', 'stale']) }));

export const JobAssign = message('job.assign', z.object({ bundle: JobBundle }));

export const JobCancel = message('job.cancel', RunningJob.extend({ reason: z.string() }));

export const Notify = message('notify', z.object({
  kind: NotifyKind,
  chatId: z.string(),
  title: z.string(),
  url: z.string(),
}));

export const ServerToCli = z.discriminatedUnion('t', [Welcome, Pong, Ack, JobAssign, JobCancel, Notify]);
export type ServerToCli = z.infer<typeof ServerToCli>;
