import { z } from 'zod';
import { message } from './envelope';
import { AgentId, AgentMode, FailureReason, NotifyKind } from './enums';
import { JobBundle } from './job-bundle';
import { JobResult } from './job-result';
import { Settings } from './web-api';

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
  // Protocol 1's `defaults` (the Auto defaults from config.json) is gone: the settings live on the server now. An
  // old CLI's hello still parses (the extra key is dropped), so the server can tell it to upgrade.
}));

export const Ping = message('ping', z.object({
  running: z.array(RunningJob),
  /** Agent runs this device started today, counted from its own midnight (the Settings page's usage bar). */
  usedToday: z.number().int().nonnegative(),
}));

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
  /** The person's settings: the CLI takes its daily job cap from here. */
  settings: Settings,
}));

export const Pong = message('pong', z.object({}));

/** The answer to job.pushing / job.complete / job.fail / job.reject. `stale` means "old attempt, ignored". */
export const Ack = message('ack', z.object({ status: z.enum(['applied', 'stale']) }));

export const JobAssign = message('job.assign', z.object({ bundle: JobBundle }));

export const JobCancel = message('job.cancel', RunningJob.extend({ reason: z.string() }));

/**
 * Someone is needed (spec §16). The CLI always prints `title` and `url` in the terminal. `alert: false` means Web Push
 * already brought this notification to the person, so the CLI shows no OS notification (push first, the CLI as
 * fallback: one ping each). A server from before Plan 2 sends no `alert`: that's an alerting one.
 */
export const Notify = message('notify', z.object({
  kind: NotifyKind,
  chatId: z.string(),
  title: z.string(),
  url: z.string(),
  alert: z.boolean().default(true),
}));

/** The person changed their settings in the web app: sent to each of their connected CLIs. */
export const SettingsMessage = message('settings', Settings);

export const ServerToCli = z.discriminatedUnion('t', [Welcome, Pong, Ack, JobAssign, JobCancel, Notify, SettingsMessage]);
export type ServerToCli = z.infer<typeof ServerToCli>;
